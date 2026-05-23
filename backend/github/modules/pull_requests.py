"""
github/modules/pull_requests.py

Enhanced Pull Request Intelligence sync.

Features:
- GraphQL paginated PR sync
- Incremental synchronization
- PR reviews sync
- PR commits sync
- PR changed files sync
- Telemetry logging
"""

from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy.orm import Session

from database.models import (
    Repository,
    PullRequest,
    PRReview,
    PRCommit,
    PRFile,
)


def sync_pull_requests(
    owner: str,
    repo_name: str,
    db: Session,
    rest_client,
    gql_client,
    repo: Repository,
    since: Optional[datetime] = None,
    progress=None,
    batch_size: int = 500,
) -> int:

    cursor = None
    has_next = True
    total_synced = 0
    stop_incremental = False

    records_fetched = 0
    records_inserted = 0
    records_updated = 0
    records_skipped = 0
    api_response_count = 0

    since_cutoff = None

    if since:
        since_cutoff = since.replace(tzinfo=timezone.utc)
        since_cutoff = since_cutoff - timedelta(days=1)
        print(f"[Telemetry][PRs] Incremental sync mode: {since_cutoff}")
    else:
        print(f"[PRs] Full sync mode for {owner}/{repo_name}")

    use_graphql = gql_client.token is not None

    if use_graphql:
        while has_next and not stop_incremental:
            try:
                raw_prs, page_info, rate_limit = gql_client.fetch_pull_requests(
                    owner,
                    repo_name,
                    first=50,
                    cursor=cursor,
                )
                api_response_count += 1
                if raw_prs:
                    records_fetched += len(raw_prs)
            except Exception as e:
                print(f"[PRs] Page fetch failed: {e}")
                break

            if not raw_prs:
                break

            for raw_pr in raw_prs:
                try:
                    parsed = gql_client.parse_pr_data(raw_pr)
                except Exception as e:
                    print(f"[PRs] Parse error: {e}")
                    continue

                pr_updated_at = parsed.get("updated_at")

                if pr_updated_at and pr_updated_at.tzinfo is None:
                    pr_updated_at = pr_updated_at.replace(tzinfo=timezone.utc)

                # Incremental cutoff
                if since_cutoff and pr_updated_at and pr_updated_at < since_cutoff:
                    existing = db.query(PullRequest).filter(
                        PullRequest.repo_id == repo.id,
                        PullRequest.pr_number == parsed["number"]
                    ).first()

                    if existing:
                        stop_incremental = True
                        print(f"[PRs] Incremental cutoff reached")
                        break

                is_skipped = False
                existing = db.query(PullRequest).filter(
                    PullRequest.repo_id == repo.id,
                    PullRequest.pr_number == parsed["number"]
                ).first()

                if existing:
                    existing_updated = existing.updated_at
                    if existing_updated and pr_updated_at and existing_updated.replace(tzinfo=timezone.utc) == pr_updated_at:
                        records_skipped += 1
                        pr_obj = existing
                        is_skipped = True
                    else:
                        _update_pr(existing, owner, repo_name, parsed)
                        pr_obj = existing
                        records_updated += 1
                        print(f"[Telemetry][PRs] Incremental Decision: Updating PR #{parsed['number']}.")
                else:
                    pr_obj = _create_pr(repo.id, owner, repo_name, parsed)
                    db.add(pr_obj)
                    db.flush()
                    records_inserted += 1
                    print(f"[Telemetry][PRs] Incremental Decision: Inserting brand new PR #{parsed['number']}.")

                # Reviews
                has_reviews = False
                if existing:
                    has_reviews = db.query(PRReview).filter(PRReview.pr_id == pr_obj.id).first() is not None

                if not (is_skipped and has_reviews):
                    _upsert_reviews(
                        db,
                        pr_obj.id,
                        repo.id,
                        parsed.get("reviews", []),
                    )

                # Commits
                has_commits = False
                if existing:
                    has_commits = db.query(PRCommit).filter(PRCommit.pr_id == pr_obj.id).first() is not None

                if not (is_skipped and has_commits):
                    try:
                        commit_nodes = rest_client.fetch_pull_request_commits(
                            owner,
                            repo_name,
                            parsed["number"],
                        )
                        _upsert_commits(
                            db,
                            pr_obj.id,
                            repo.id,
                            commit_nodes,
                        )
                        print(
                            f"[Telemetry][Commits] PR #{parsed['number']}: "
                            f"fetched={len(commit_nodes)}, db_records={len(commit_nodes)}"
                        )
                    except Exception as e:
                        print(f"[Telemetry][Commits] Failed for PR #{parsed['number']}: {e}")

                # Files
                has_files = False
                if existing:
                    has_files = db.query(PRFile).filter(PRFile.pr_id == pr_obj.id).first() is not None

                if not (is_skipped and has_files):
                    try:
                        file_nodes = rest_client.fetch_pull_request_files(
                            owner,
                            repo_name,
                            parsed["number"],
                        )
                        _upsert_files(
                            db,
                            pr_obj.id,
                            repo.id,
                            file_nodes,
                        )
                        print(
                            f"[Telemetry][Files] PR #{parsed['number']}: "
                            f"fetched={len(file_nodes)}, db_records={len(file_nodes)}"
                        )
                    except Exception as e:
                        print(f"[Telemetry][Files] Failed for PR #{parsed['number']}: {e}")

                total_synced += 1

                if progress and total_synced % 10 == 0:
                    progress.update(
                        f"Syncing {owner}/{repo_name} Pull Requests",
                        module="pull_requests",
                        processed=total_synced,
                        discovered=max(total_synced, repo.total_prs or 0),
                    )

                if total_synced % batch_size == 0:
                    db.commit()

            has_next = page_info.get("hasNextPage", False)
            cursor = page_info.get("endCursor")

        db.commit()
    else:
        # Lightweight REST-based PR sync
        print(f"[PRs] Using lightweight REST-based sync for {owner}/{repo_name}")
        pages_generator = rest_client.get_pull_requests(owner, repo_name)
        for raw_prs in pages_generator:
            if stop_incremental:
                break
            api_response_count += 1
            if raw_prs:
                records_fetched += len(raw_prs)

            for raw_pr in raw_prs:
                try:
                    parsed = rest_client.parse_rest_pr_data(raw_pr)
                except Exception as e:
                    print(f"[PRs] REST parse error: {e}")
                    continue

                pr_updated_at = parsed.get("updated_at")

                if pr_updated_at and pr_updated_at.tzinfo is None:
                    pr_updated_at = pr_updated_at.replace(tzinfo=timezone.utc)

                # Incremental cutoff
                if since_cutoff and pr_updated_at and pr_updated_at < since_cutoff:
                    existing = db.query(PullRequest).filter(
                        PullRequest.repo_id == repo.id,
                        PullRequest.pr_number == parsed["number"]
                    ).first()
                    if existing:
                        stop_incremental = True
                        print(f"[PRs] Incremental cutoff reached")
                        break

                is_skipped = False
                existing = db.query(PullRequest).filter(
                    PullRequest.repo_id == repo.id,
                    PullRequest.pr_number == parsed["number"]
                ).first()

                if existing:
                    existing_updated = existing.updated_at
                    if existing_updated and pr_updated_at and existing_updated.replace(tzinfo=timezone.utc) == pr_updated_at:
                        records_skipped += 1
                        pr_obj = existing
                        is_skipped = True
                    else:
                        _update_pr(existing, owner, repo_name, parsed)
                        pr_obj = existing
                        records_updated += 1
                        print(f"[Telemetry][PRs] Incremental Decision: Updating PR #{parsed['number']}.")
                else:
                    pr_obj = _create_pr(repo.id, owner, repo_name, parsed)
                    db.add(pr_obj)
                    db.flush()
                    records_inserted += 1
                    print(f"[Telemetry][PRs] Incremental Decision: Inserting brand new PR #{parsed['number']}.")

                # Reviews
                has_reviews = False
                if existing:
                    has_reviews = db.query(PRReview).filter(PRReview.pr_id == pr_obj.id).first() is not None

                if not (is_skipped and has_reviews):
                    try:
                        review_nodes = rest_client.get_pr_reviews(owner, repo_name, parsed["number"])
                        _upsert_reviews(db, pr_obj.id, repo.id, review_nodes)
                        pr_obj.review_count = len(review_nodes)
                    except Exception as e:
                        print(f"[Telemetry][Reviews] Failed for PR #{parsed['number']}: {e}")

                # Commits
                has_commits = False
                if existing:
                    has_commits = db.query(PRCommit).filter(PRCommit.pr_id == pr_obj.id).first() is not None

                if not (is_skipped and has_commits):
                    try:
                        commit_nodes = rest_client.fetch_pull_request_commits(
                            owner,
                            repo_name,
                            parsed["number"],
                        )
                        _upsert_commits(
                            db,
                            pr_obj.id,
                            repo.id,
                            commit_nodes,
                        )
                        pr_obj.commit_count = len(commit_nodes)
                    except Exception as e:
                        print(f"[Telemetry][Commits] Failed for PR #{parsed['number']}: {e}")

                # Files
                has_files = False
                if existing:
                    has_files = db.query(PRFile).filter(PRFile.pr_id == pr_obj.id).first() is not None

                if not (is_skipped and has_files):
                    try:
                        file_nodes = rest_client.fetch_pull_request_files(
                            owner,
                            repo_name,
                            parsed["number"],
                        )
                        _upsert_files(
                            db,
                            pr_obj.id,
                            repo.id,
                            file_nodes,
                        )
                        pr_obj.files_changed = len(file_nodes)
                        pr_obj.lines_added = sum(f.get("additions", 0) for f in file_nodes if f)
                        pr_obj.lines_deleted = sum(f.get("deletions", 0) for f in file_nodes if f)
                    except Exception as e:
                        print(f"[Telemetry][Files] Failed for PR #{parsed['number']}: {e}")

                total_synced += 1

                if progress and total_synced % 10 == 0:
                    progress.update(
                        f"Syncing {owner}/{repo_name} Pull Requests",
                        module="pull_requests",
                        processed=total_synced,
                        discovered=max(total_synced, repo.total_prs or 0),
                    )

                if total_synced % batch_size == 0:
                    db.commit()

        db.commit()

    repo.total_prs = db.query(PullRequest).filter(
        PullRequest.repo_id == repo.id
    ).count()

    db.commit()

    print(f"[Telemetry][PRs] Sync complete. Stats: fetched={records_fetched}, inserted={records_inserted}, updated={records_updated}, skipped={records_skipped}, api_responses={api_response_count}")
    print(f"[PRs] Sync complete. Synced: {total_synced}, Total in DB: {repo.total_prs}")

    return total_synced


def _create_pr(repo_id: int, owner: str, repo_name: str, parsed: dict):

    return PullRequest(
        repo_id=repo_id,
        repo_owner=owner,
        repo_name=repo_name,
        pr_number=parsed["number"],
        github_node_id=parsed.get("github_node_id"),
        title=(parsed.get("title") or "")[:200],
        body=parsed.get("body"),
        state=parsed["state"],
        draft=parsed.get("draft", False),
        merge_state=parsed.get("merge_state"),
        labels=parsed.get("labels", ""),
        base_branch=parsed.get("base_branch"),
        head_branch=parsed.get("head_branch"),
        author=parsed.get("author", "unknown")[:100],
        created_at=parsed["created_at"],
        updated_at=parsed.get("updated_at"),
        merged_at=parsed.get("merged_at"),
        closed_at=parsed.get("closed_at"),
        commit_count=parsed.get("commit_count", 0),
        files_changed=parsed.get("files_changed", 0),
        lines_added=parsed.get("lines_added", 0),
        lines_deleted=parsed.get("lines_deleted", 0),
        review_count=parsed.get("review_count", 0),
        comment_count=parsed.get("comment_count", 0),
    )


def _update_pr(existing: PullRequest, owner: str, repo_name: str, parsed: dict):

    existing.repo_owner = owner
    existing.repo_name = repo_name
    existing.title = (parsed.get("title") or "")[:200]
    existing.body = parsed.get("body")
    existing.state = parsed["state"]
    existing.draft = parsed.get("draft", False)
    existing.merge_state = parsed.get("merge_state")
    existing.labels = parsed.get("labels", "")
    existing.base_branch = parsed.get("base_branch")
    existing.head_branch = parsed.get("head_branch")
    existing.updated_at = parsed.get("updated_at")
    existing.merged_at = parsed.get("merged_at")
    existing.closed_at = parsed.get("closed_at")
    existing.commit_count = parsed.get("commit_count", 0)
    existing.files_changed = parsed.get("files_changed", 0)
    existing.lines_added = parsed.get("lines_added", 0)
    existing.lines_deleted = parsed.get("lines_deleted", 0)
    existing.review_count = parsed.get("review_count", 0)
    existing.comment_count = parsed.get("comment_count", 0)


def _upsert_reviews(db, pr_id, repo_id, review_nodes):

    for rev in review_nodes:

        reviewer = "unknown"
        if "author" in rev:
            reviewer = (rev.get("author") or {}).get("login", "unknown")
        elif "user" in rev:
            reviewer = (rev.get("user") or {}).get("login", "unknown")

        submitted_at = None
        submitted_at_str = rev.get("submittedAt") or rev.get("submitted_at")
        if submitted_at_str:
            submitted_at = datetime.fromisoformat(
                submitted_at_str.replace("Z", "+00:00")
            )

        existing = db.query(PRReview).filter(
            PRReview.pr_id == pr_id,
            PRReview.reviewer == reviewer,
            PRReview.submitted_at == submitted_at,
        ).first()

        if existing:
            existing.state = rev.get("state", "COMMENTED")

        else:
            comment_count = 0
            if isinstance(rev.get("comments"), dict):
                comment_count = rev.get("comments", {}).get("totalCount", 0)
            db.add(
                PRReview(
                    pr_id=pr_id,
                    repo_id=repo_id,
                    reviewer=reviewer,
                    state=rev.get("state", "COMMENTED"),
                    submitted_at=submitted_at,
                    comment_count=comment_count,
                )
            )


def _upsert_commits(db, pr_id, repo_id, commit_nodes):

    for commit in commit_nodes:

        sha = commit.get("sha")

        if not sha:
            continue

        existing = db.query(PRCommit).filter(
            PRCommit.pr_id == pr_id,
            PRCommit.sha == sha,
        ).first()

        if existing:
            continue

        commit_info = commit.get("commit", {})
        author_info = commit_info.get("author", {})

        committed_at = None

        if author_info.get("date"):
            committed_at = datetime.fromisoformat(
                author_info["date"].replace("Z", "+00:00")
            )

        db.add(
            PRCommit(
                pr_id=pr_id,
                repo_id=repo_id,
                sha=sha,
                message=commit_info.get("message"),
                author=author_info.get("name"),
                committed_at=committed_at,
                additions=0,
                deletions=0,
            )
        )


def _upsert_files(db, pr_id, repo_id, file_nodes):

    for file in file_nodes:

        filename = file.get("filename")

        if not filename:
            continue

        existing = db.query(PRFile).filter(
            PRFile.pr_id == pr_id,
            PRFile.filename == filename,
        ).first()

        if existing:
            existing.status = file.get("status")
            existing.additions = file.get("additions", 0)
            existing.deletions = file.get("deletions", 0)

        else:
            db.add(
                PRFile(
                    pr_id=pr_id,
                    repo_id=repo_id,
                    filename=filename,
                    status=file.get("status"),
                    additions=file.get("additions", 0),
                    deletions=file.get("deletions", 0),
                    changes=file.get("changes", 0),
                )
            )