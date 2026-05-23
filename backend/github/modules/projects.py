"""
github/modules/projects.py

Module 7 — Project Analytics sync.

Strategy: GitHub Projects v2 (GraphQL) first, then v1 REST fallback when v2
returns no readable nodes (e.g. missing read:project scope).
"""
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session

from database.models import Repository, Project


def sync_projects(
    owner: str,
    repo_name: str,
    db: Session,
    gql_client,
    repo: Repository,
    rest_client=None,
    progress=None,
    batch_size: int = 500,
) -> int:
    """
    Sync GitHub Projects v2 via GraphQL, with v1 REST fallback.
    Returns count of projects synced.
    """
    print(f"[Telemetry][Projects] Syncing projects for {owner}/{repo_name}")

    if rest_client:
        scope_info = rest_client.get_token_scopes()
        if scope_info.get("has_token") and not scope_info.get("has_project_scope"):
            scopes = scope_info.get("scopes") or []
            if scopes and "read:project" not in scopes and "project" not in " ".join(scopes):
                print(
                    "[Telemetry][Projects] Token may lack read:project scope — "
                    "Projects v2 nodes can be null; v1 REST fallback will be attempted."
                )

    features = gql_client.fetch_repository_module_features(owner, repo_name)
    print(
        f"[Telemetry][Projects] Feature probe: github_total={features.get('projects_total')}, "
        f"status={features.get('status')}"
    )
    if features.get("status") == "auth":
        print("[Telemetry][Projects] Aborting sync — invalid GitHub token.")
        _finalize_project_count(db, repo)
        return 0

    github_total = features.get("projects_total", 0) or 0
    total_synced = _sync_projects_v2(owner, repo_name, db, gql_client, repo, progress, batch_size)

    if total_synced == 0 and github_total > 0 and rest_client:
        print(
            f"[Telemetry][Projects] v2 synced 0 but GitHub reports {github_total} project(s) — "
            "trying v1 REST fallback."
        )
        total_synced = _sync_projects_v1(owner, repo_name, db, rest_client, repo, batch_size)
    elif total_synced == 0 and github_total == 0:
        print(f"[Telemetry][Projects] No projects on {owner}/{repo_name} — valid zero state.")

    _finalize_project_count(db, repo)
    if progress:
        progress.update(
            f"Projects sync complete: {total_synced:,} records",
            processed=total_synced,
            discovered=total_synced,
        )
    print(f"[Projects] Sync complete. Synced: {total_synced}, Total in DB: {repo.total_projects}")
    return total_synced


def _finalize_project_count(db: Session, repo: Repository):
    repo.total_projects = db.query(Project).filter(Project.repo_id == repo.id).count()
    db.commit()


def _sync_projects_v2(owner, repo_name, db, gql_client, repo, progress, batch_size) -> int:
    """Sync Projects v2 via GraphQL."""
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
            nodes, page_info = gql_client.fetch_projects_v2(
                owner, repo_name, first=20, cursor=cursor
            )
            api_response_count += 1
            print(
                f"[Telemetry][Projects] Pagination page {page_num}: "
                f"received {len(nodes)} project record(s)."
            )
        except Exception as e:
            print(f"[Projects v2] Fetch error: {e}")
            break

        if not nodes:
            break

        records_fetched += len(nodes)

        for item in nodes:
            if not item:
                records_skipped += 1
                continue
            try:
                status = _upsert_project_v2(db, repo, owner, repo_name, item)
                if status == "inserted":
                    records_inserted += 1
                    total_synced += 1
                    batch_buffer.append(total_synced)
                    print(
                        f"[Telemetry][Projects] Inserted Project v2 #{item.get('number')}."
                    )
                elif status == "updated":
                    records_updated += 1
                    total_synced += 1
                    batch_buffer.append(total_synced)
                    print(
                        f"[Telemetry][Projects] Updated Project v2 #{item.get('number')}."
                    )
                elif status == "skipped":
                    records_skipped += 1
            except Exception as e:
                print(f"[Projects v2] Upsert error: {e}")
                continue

            if progress and total_synced % 10 == 0:
                progress.update(
                    f"Syncing {owner}/{repo_name} Projects",
                    module="projects",
                    processed=total_synced,
                    discovered=max(total_synced, repo.total_projects or 0),
                )

            if len(batch_buffer) >= batch_size:
                db.commit()
                batch_buffer.clear()

        has_next = page_info.get("hasNextPage", False)
        cursor = page_info.get("endCursor")

    if batch_buffer:
        db.commit()
        batch_buffer.clear()

    print(
        f"[Telemetry][Projects] v2 sync stats: fetched={records_fetched}, "
        f"inserted={records_inserted}, updated={records_updated}, "
        f"skipped={records_skipped}, api_responses={api_response_count}"
    )
    return total_synced


def _sync_projects_v1(owner, repo_name, db, rest_client, repo, batch_size) -> int:
    """Sync classic Projects v1 via REST (deprecated on many orgs)."""
    records_inserted = 0
    records_updated = 0
    records_skipped = 0

    try:
        projects = rest_client.get_projects_v1(owner, repo_name)
    except Exception as e:
        print(f"[Telemetry][Projects] v1 REST fetch failed: {e}")
        return 0

    print(f"[Telemetry][Projects] v1 REST response count: {len(projects)} projects")
    if not projects:
        return 0

    total_synced = 0
    for item in projects:
        try:
            status = _upsert_project_v1(db, repo, item)
            if status == "inserted":
                records_inserted += 1
                total_synced += 1
            elif status == "updated":
                records_updated += 1
                total_synced += 1
            else:
                records_skipped += 1
        except Exception as e:
            print(f"[Projects v1] Upsert error: {e}")
            continue

    db.commit()
    print(
        f"[Telemetry][Projects] v1 sync stats: inserted={records_inserted}, "
        f"updated={records_updated}, skipped={records_skipped}"
    )
    return total_synced


def _upsert_project_v2(db, repo, owner, repo_name, item) -> str:
    github_node_id = item.get("id")
    number = item.get("number")

    existing = db.query(Project).filter(
        Project.repo_id == repo.id,
        Project.github_node_id == github_node_id,
    ).first() if github_node_id else None

    creator = (item.get("creator") or {}).get("login")
    state = "closed" if item.get("closed") else "open"
    items_total = (item.get("items") or {}).get("totalCount", 0)
    updated_at = _parse_dt(item.get("updatedAt"))

    if existing:
        existing_updated = existing.updated_at
        if existing_updated and updated_at and existing_updated.replace(tzinfo=timezone.utc) == updated_at.replace(tzinfo=timezone.utc):
            return "skipped"
        existing.number = number
        existing.name = (item.get("title") or "")[:512]
        existing.body = item.get("shortDescription")
        existing.state = state
        existing.creator = creator
        existing.items_count = items_total
        existing.updated_at = updated_at
        existing.synced_at = datetime.utcnow()
        return "updated"

    proj = Project(
        repo_id=repo.id,
        github_node_id=github_node_id,
        number=number,
        name=(item.get("title") or "")[:512],
        body=item.get("shortDescription"),
        state=state,
        creator=creator,
        project_type="v2",
        items_count=items_total,
        created_at=_parse_dt(item.get("createdAt")),
        updated_at=updated_at,
    )
    db.add(proj)
    return "inserted"


def _upsert_project_v1(db, repo, item) -> str:
    github_id = item.get("id")
    existing = db.query(Project).filter(
        Project.repo_id == repo.id,
        Project.github_id == github_id,
    ).first() if github_id else None

    creator = (item.get("creator") or {}).get("login")
    state = item.get("state") or "open"
    updated_at = _parse_dt(item.get("updated_at"))

    if existing:
        if existing.updated_at and updated_at and existing.updated_at.replace(tzinfo=timezone.utc) == updated_at.replace(tzinfo=timezone.utc):
            return "skipped"
        existing.name = (item.get("name") or "")[:512]
        existing.body = item.get("body")
        existing.state = state
        existing.creator = creator
        existing.updated_at = updated_at
        existing.synced_at = datetime.utcnow()
        return "updated"

    proj = Project(
        repo_id=repo.id,
        github_id=github_id,
        github_node_id=item.get("node_id"),
        name=(item.get("name") or "")[:512],
        body=item.get("body"),
        state=state,
        creator=creator,
        project_type="v1",
        created_at=_parse_dt(item.get("created_at")),
        updated_at=updated_at,
    )
    db.add(proj)
    return "inserted"


def _parse_dt(val) -> Optional[datetime]:
    if not val:
        return None
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        return None
