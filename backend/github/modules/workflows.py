"""
github/modules/workflows.py

Module 8 — Actions / CI-CD Intelligence sync.

Uses GitHub REST API:
  /actions/workflows       — list workflows
  /actions/runs            — paginated runs with incremental sync
  /actions/runs/{id}/jobs  — jobs per run (fetched for recent runs)

Incremental sync: passes created>=since to run listing.
"""
from datetime import datetime, timezone
from typing import Optional, Tuple
from sqlalchemy.orm import Session

from database.models import Repository, Workflow, WorkflowRun, WorkflowJob


def sync_workflows(
    owner: str,
    repo_name: str,
    db: Session,
    rest_client,
    repo: Repository,
    since: Optional[datetime] = None,
    progress=None,
    batch_size: int = 500,
) -> int:
    """
    Sync workflows, runs, and jobs from GitHub Actions REST API.
    Returns total run records synced.
    """
    print(f"[Telemetry][CI/CD] Syncing workflows for {owner}/{repo_name}")
    since_iso = None
    if since:
        since_ts = since.replace(tzinfo=timezone.utc) if since.tzinfo is None else since
        since_iso = since_ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        print(f"[Telemetry][CI/CD] Ingestion Mode: Incremental. Runs created >= {since_iso}")
    else:
        print(f"[Telemetry][CI/CD] Ingestion Mode: Full sync mode for {owner}/{repo_name}")

    total_runs_synced = 0
    records_fetched = 0
    records_inserted = 0
    records_updated = 0
    records_skipped = 0
    api_response_count = 0
    page_num = 0

    # Step 1: Sync workflow definitions
    workflow_id_map = _sync_workflow_definitions(db, repo, owner, repo_name, rest_client)

    # Step 2: Sync workflow runs
    batch_buffer = []
    for page_runs in rest_client.get_all_workflow_runs_raw(owner, repo_name, since=since_iso):
        page_num += 1
        api_response_count += 1
        records_fetched += len(page_runs)
        print(f"[Telemetry][CI/CD] Pagination Progress: Fetching page {page_num}. Received {len(page_runs)} workflow run records.")

        for run_item in page_runs:
            try:
                run_obj, status = _upsert_workflow_run(db, repo, run_item, workflow_id_map)
                if run_obj:
                    if status == "inserted":
                        records_inserted += 1
                        total_runs_synced += 1
                        batch_buffer.append(1)
                        print(f"[Telemetry][CI/CD] Incremental Decision: Inserting brand new Workflow Run #{run_item.get('id')}.")
                    elif status == "updated":
                        records_updated += 1
                        total_runs_synced += 1
                        batch_buffer.append(1)
                        print(f"[Telemetry][CI/CD] Incremental Decision: Updating Workflow Run #{run_item.get('id')}.")
                    elif status == "skipped":
                        records_skipped += 1

            except Exception as e:
                print(f"[CI/CD] Error upserting run {run_item.get('id', '?')}: {e}")
                continue

            if progress and total_runs_synced % 100 == 0:
                progress.update(
                    f"Syncing {owner}/{repo_name} Workflow Runs",
                    module="workflows",
                    processed=total_runs_synced,
                    discovered=max(total_runs_synced, repo.total_workflow_runs or 0),
                )

            if len(batch_buffer) >= batch_size:
                db.commit()
                batch_buffer.clear()

    if batch_buffer:
        db.commit()
        batch_buffer.clear()

    repo.total_workflow_runs = db.query(WorkflowRun).filter(WorkflowRun.repo_id == repo.id).count()
    db.commit()

    if progress:
        progress.update(
            f"CI/CD sync complete: {total_runs_synced:,} runs",
            processed=total_runs_synced,
            discovered=total_runs_synced,
        )

    print(f"[Telemetry][CI/CD] Sync complete. Stats: fetched={records_fetched}, inserted={records_inserted}, updated={records_updated}, skipped={records_skipped}, api_responses={api_response_count}")
    print(f"[CI/CD] Sync complete. Runs synced: {total_runs_synced}, Total in DB: {repo.total_workflow_runs}")
    return total_runs_synced


def _sync_workflow_definitions(db, repo, owner, repo_name, rest_client) -> dict:
    """Sync workflow definitions and return {github_id -> db_id} map."""
    workflow_map = {}
    try:
        workflows = rest_client._get_workflows_raw(owner, repo_name)
        for wf in workflows:
            github_id = wf.get("id")
            if not github_id:
                continue
            existing = db.query(Workflow).filter(
                Workflow.repo_id == repo.id,
                Workflow.github_id == github_id
            ).first()
            if existing:
                existing.name = (wf.get("name") or "")[:512]
                existing.path = (wf.get("path") or "")[:1024]
                existing.state = wf.get("state")
                workflow_map[github_id] = existing.id
            else:
                wf_obj = Workflow(
                    repo_id=repo.id,
                    github_id=github_id,
                    name=(wf.get("name") or "")[:512],
                    path=(wf.get("path") or "")[:1024],
                    state=wf.get("state"),
                    created_at=_parse_dt(wf.get("created_at")),
                    updated_at=_parse_dt(wf.get("updated_at")),
                )
                db.add(wf_obj)
                db.flush()
                workflow_map[github_id] = wf_obj.id
        db.commit()
    except Exception as e:
        print(f"[CI/CD] Error syncing workflow definitions: {e}")
    return workflow_map


def _upsert_workflow_run(db, repo, run_item, workflow_id_map) -> Tuple[Optional[WorkflowRun], str]:
    github_run_id = run_item.get("id")
    if not github_run_id:
        return None, "skipped"

    # Map GitHub workflow ID to DB workflow ID
    wf_github_id = (run_item.get("workflow_id") or
                    (run_item.get("workflow") or {}).get("id"))
    db_workflow_id = workflow_id_map.get(wf_github_id)

    if not db_workflow_id:
        # Create placeholder workflow if not found
        wf_obj = Workflow(
            repo_id=repo.id,
            github_id=wf_github_id,
            name=(run_item.get("name") or "Unknown")[:512],
            state="active",
        )
        db.add(wf_obj)
        db.flush()
        db_workflow_id = wf_obj.id
        if wf_github_id:
            workflow_id_map[wf_github_id] = db_workflow_id

    created_at = _parse_dt(run_item.get("created_at"))
    updated_at = _parse_dt(run_item.get("updated_at"))
    run_started_at = _parse_dt(run_item.get("run_started_at"))

    # Compute duration
    duration_seconds = None
    if run_started_at and updated_at:
        s = run_started_at.replace(tzinfo=timezone.utc) if run_started_at.tzinfo is None else run_started_at
        e = updated_at.replace(tzinfo=timezone.utc) if updated_at.tzinfo is None else updated_at
        diff = (e - s).total_seconds()
        if diff >= 0:
            duration_seconds = int(diff)

    existing = db.query(WorkflowRun).filter(
        WorkflowRun.repo_id == repo.id,
        WorkflowRun.github_run_id == github_run_id
    ).first()

    if existing:
        existing_updated = existing.updated_at
        if existing_updated and updated_at and existing_updated.replace(tzinfo=timezone.utc) == updated_at.replace(tzinfo=timezone.utc) and existing.status == run_item.get("status") and existing.conclusion == run_item.get("conclusion"):
            return existing, "skipped"
        existing.status = run_item.get("status")
        existing.conclusion = run_item.get("conclusion")
        existing.updated_at = updated_at
        existing.duration_seconds = duration_seconds
        return existing, "updated"
    else:
        run_obj = WorkflowRun(
            workflow_id=db_workflow_id,
            repo_id=repo.id,
            github_run_id=github_run_id,
            name=(run_item.get("name") or run_item.get("display_title") or "")[:512],
            head_branch=run_item.get("head_branch"),
            head_sha=run_item.get("head_sha"),
            event=run_item.get("event"),
            status=run_item.get("status"),
            conclusion=run_item.get("conclusion"),
            run_number=run_item.get("run_number"),
            run_attempt=run_item.get("run_attempt", 1),
            actor=(run_item.get("actor") or {}).get("login"),
            created_at=created_at,
            updated_at=updated_at,
            run_started_at=run_started_at,
            duration_seconds=duration_seconds,
        )
        db.add(run_obj)
        return run_obj, "inserted"


def _parse_dt(val) -> Optional[datetime]:
    if not val:
        return None
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except Exception:
        return None
