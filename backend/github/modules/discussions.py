"""
github/modules/discussions.py

Module 6 — Discussion Analytics sync.

Uses GitHub GraphQL API (repository.discussions).
If discussions are not enabled on a repo, returns 0 gracefully.
"""
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session

from database.models import Repository, Discussion


def sync_discussions(
    owner: str,
    repo_name: str,
    db: Session,
    gql_client,
    repo: Repository,
    progress=None,
    batch_size: int = 500,
) -> int:
    """
    Full GraphQL paginated discussion sync.
    Returns count of discussions synced.
    """
    print(f"[Telemetry][Discussions] Syncing discussions for {owner}/{repo_name}")

    features = gql_client.fetch_repository_module_features(owner, repo_name)
    print(
        f"[Telemetry][Discussions] Feature probe: enabled={features.get('discussions_enabled')}, "
        f"github_total={features.get('discussions_total')}, status={features.get('status')}"
    )
    if features.get("status") == "auth":
        print("[Telemetry][Discussions] Aborting sync — invalid GitHub token.")
        return 0
    if not features.get("discussions_enabled") and features.get("discussions_total", 0) == 0:
        print(f"[Telemetry][Discussions] Discussions not enabled on {owner}/{repo_name} — valid zero state.")
        repo.total_discussions = 0
        db.commit()
        return 0

    total_synced = 0
    cursor = None
    has_next = True
    batch_buffer = []

    records_fetched = 0
    records_inserted = 0
    records_updated = 0
    records_skipped = 0
    api_response_count = 0
    page_num = 0

    while has_next:
        page_num += 1
        try:
            nodes, page_info = gql_client.fetch_discussions(
                owner, repo_name, first=50, cursor=cursor
            )
            api_response_count += 1
            print(f"[Telemetry][Discussions] Pagination Progress: Fetching page {page_num} (cursor={cursor}). Received {len(nodes)} discussion records.")
        except Exception as e:
            print(f"[Discussions] Fetch error: {e}")
            break

        if not nodes:
            break

        records_fetched += len(nodes)

        for item in nodes:
            try:
                status = _upsert_discussion(db, repo, owner, repo_name, item)
                if status == "inserted":
                    records_inserted += 1
                    total_synced += 1
                    batch_buffer.append(total_synced)
                    print(f"[Telemetry][Discussions] Incremental Decision: Inserting brand new Discussion #{item.get('number')}.")
                elif status == "updated":
                    records_updated += 1
                    total_synced += 1
                    batch_buffer.append(total_synced)
                    print(f"[Telemetry][Discussions] Incremental Decision: Updating Discussion #{item.get('number')}.")
                elif status == "skipped":
                    records_skipped += 1
                    # print(f"[Telemetry][Discussions] Incremental Decision: Skipping unchanged Discussion #{item.get('number')}.")
            except Exception as e:
                print(f"[Discussions] Upsert error for discussion #{item.get('number', '?')}: {e}")
                continue

            if progress and total_synced % 50 == 0:
                progress.update(
                    f"Syncing {owner}/{repo_name} Discussions",
                    module="discussions",
                    processed=total_synced,
                    discovered=max(total_synced, repo.total_discussions or 0),
                )

            if len(batch_buffer) >= batch_size:
                db.commit()
                batch_buffer.clear()

        has_next = page_info.get("hasNextPage", False)
        cursor = page_info.get("endCursor")

    if batch_buffer:
        db.commit()
        batch_buffer.clear()

    repo.total_discussions = db.query(Discussion).filter(Discussion.repo_id == repo.id).count()
    db.commit()

    if progress:
        progress.update(f"Discussions sync complete: {total_synced:,} records", processed=total_synced, discovered=total_synced)

    print(f"[Telemetry][Discussions] Sync complete. Stats: fetched={records_fetched}, inserted={records_inserted}, updated={records_updated}, skipped={records_skipped}, api_responses={api_response_count}")
    print(f"[Discussions] Sync complete. Synced: {total_synced}, Total in DB: {repo.total_discussions}")
    return total_synced


def _upsert_discussion(db: Session, repo: Repository, owner: str, repo_name: str, item: dict) -> str:
    github_id = item.get("id")
    number = item.get("number")

    existing = db.query(Discussion).filter(
        Discussion.repo_id == repo.id,
        Discussion.discussion_number == number
    ).first() if number else None

    category = (item.get("category") or {}).get("name")
    author = (item.get("author") or {}).get("login", "unknown")
    state = "CLOSED" if item.get("closed") else "OPEN"
    answer_chosen = item.get("answer") is not None
    comment_count = (item.get("comments") or {}).get("totalCount", 0)
    reaction_count = (item.get("reactions") or {}).get("totalCount", 0)
    participant_count = (item.get("participants") or {}).get("totalCount", 0)
    created_at = _parse_dt(item.get("createdAt"))
    updated_at = _parse_dt(item.get("updatedAt"))

    if existing:
        existing_updated = existing.updated_at
        if existing_updated and updated_at and existing_updated.replace(tzinfo=timezone.utc) == updated_at.replace(tzinfo=timezone.utc):
            return "skipped"
        existing.github_id = github_id
        existing.title = (item.get("title") or "")[:1000]
        existing.body = item.get("body")
        existing.category = category
        existing.author = author
        existing.state = state
        existing.answer_chosen = answer_chosen
        existing.comment_count = comment_count
        existing.reaction_count = reaction_count
        existing.participant_count = participant_count
        existing.updated_at = updated_at
        existing.synced_at = datetime.utcnow()
        return "updated"
    else:
        disc = Discussion(
            repo_id=repo.id,
            repo_owner=owner,
            repo_name=repo_name,
            github_id=github_id,
            discussion_number=number,
            title=(item.get("title") or "")[:1000],
            body=item.get("body"),
            category=category,
            author=author,
            state=state,
            answer_chosen=answer_chosen,
            comment_count=comment_count,
            reaction_count=reaction_count,
            participant_count=participant_count,
            created_at=created_at,
            updated_at=updated_at,
        )
        db.add(disc)
        return "inserted"


def _parse_dt(val) -> Optional[datetime]:
    if not val:
        return None
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        return None
