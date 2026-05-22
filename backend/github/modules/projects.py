"""
github/modules/projects.py

Module 7 — Project Analytics sync.

Strategy: GitHub Projects v2 (GraphQL) first.
Architecture is modular for v1 REST fallback if needed later.
"""
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session

from database.models import Repository, Project, ProjectItem


def sync_projects(
    owner: str,
    repo_name: str,
    db: Session,
    gql_client,
    repo: Repository,
    progress=None,
    batch_size: int = 500,
) -> int:
    """
    Sync GitHub Projects v2 via GraphQL.
    Falls back to v1 REST if v2 returns nothing.
    Returns count of projects synced.
    """
    print(f"[Telemetry][Projects] Syncing projects v2 for {owner}/{repo_name}")
    total_synced = _sync_projects_v2(owner, repo_name, db, gql_client, repo, progress, batch_size)
    print(f"[Projects] Sync complete. Synced: {total_synced}")
    return total_synced


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
            print(f"[Telemetry][Projects] Pagination Progress: Fetching page {page_num} (cursor={cursor}). Received {len(nodes)} project records.")
        except Exception as e:
            print(f"[Projects v2] Fetch error: {e}")
            break

        if not nodes:
            break

        records_fetched += len(nodes)

        for item in nodes:
            try:
                status = _upsert_project_v2(db, repo, owner, repo_name, item)
                if status == "inserted":
                    records_inserted += 1
                    total_synced += 1
                    batch_buffer.append(total_synced)
                    print(f"[Telemetry][Projects] Incremental Decision: Inserting brand new Project v2 #{item.get('number')}.")
                elif status == "updated":
                    records_updated += 1
                    total_synced += 1
                    batch_buffer.append(total_synced)
                    print(f"[Telemetry][Projects] Incremental Decision: Updating Project v2 #{item.get('number')}.")
                elif status == "skipped":
                    records_skipped += 1
                    # print(f"[Telemetry][Projects] Incremental Decision: Skipping unchanged Project v2 #{item.get('number')}.")
            except Exception as e:
                print(f"[Projects v2] Upsert error: {e}")
                continue

            if len(batch_buffer) >= batch_size:
                db.commit()
                batch_buffer.clear()

        has_next = page_info.get("hasNextPage", False)
        cursor = page_info.get("endCursor")

    if batch_buffer:
        db.commit()
        batch_buffer.clear()

    print(f"[Telemetry][Projects] Sync complete. Stats: fetched={records_fetched}, inserted={records_inserted}, updated={records_updated}, skipped={records_skipped}, api_responses={api_response_count}")
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
    else:
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


def _parse_dt(val) -> Optional[datetime]:
    if not val:
        return None
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        return None
