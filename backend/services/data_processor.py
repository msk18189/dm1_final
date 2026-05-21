from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from database.models import PullRequest, Repository, Contributor, MLPrediction, TotalAnalysis
from github.client import GitHubClient
import numpy as np

def parse_github_repo_url(repo_url: str) -> tuple[str, str]:
    """Parse owner/repo from various GitHub URL formats."""
    url = repo_url.strip().rstrip("/")
    if url.endswith(".git"):
        url = url[:-4]
    if "github.com" in url:
        path = url.split("github.com/", 1)[-1]
    else:
        path = url
    parts = [p for p in path.split("/") if p and p not in ("tree", "blob", "pulls", "issues")]
    if len(parts) < 2:
        raise ValueError(
            "Invalid GitHub URL. Use https://github.com/owner/repo or owner/repo"
        )
    return parts[0], parts[1]


def normalize_github_url(owner: str, repo_name: str) -> str:
    """Return a canonical GitHub repository URL for the repo."""
    return f"https://github.com/{owner}/{repo_name}"


class DataProcessor:
    def __init__(self, db: Session):
        self.db = db
        self.ml_models = None  # Lazy load ML models
    
    def _get_ml_models(self):
        """Lazy load ML models to avoid import errors"""
        if self.ml_models is None:
            try:
                from ml.models import MLModels
                self.ml_models = MLModels()
                print("[ML] ML models loaded successfully")
            except Exception as e:
                print(f"[ML WARNING] Could not load ML models: {str(e)}")
                self.ml_models = False  # Mark as failed
        return self.ml_models if self.ml_models else None
    
    def process_repository(self, repo_url: str, github_token: Optional[str] = None) -> Dict[str, Any]:
        """Process GitHub repository and extract PR data.

        github_token: optional PAT from the user (for private repos or higher limits).
        Falls back to GITHUB_TOKEN in environment when omitted.
        """
        try:
            # Parse URL
            owner, repo_name = parse_github_repo_url(repo_url)
            
            print(f"[1/6] Processing repository: {owner}/{repo_name}")
            
            # Check if repo exists in DB
            canonical_url = normalize_github_url(owner, repo_name)
            repo = self.db.query(Repository).filter(
                Repository.owner == owner,
                Repository.name == repo_name
            ).first()
            
            if not repo:
                full_name = f"{owner}/{repo_name}"
                repo = Repository(
                    owner=owner,
                    name=repo_name,
                    full_name=full_name,
                    url=canonical_url,
                    source_url=repo_url,
                    stars=0,
                    last_synced=datetime.utcnow(),
                )
                self.db.add(repo)
                try:
                    self.db.commit()
                    print(f"[2/6] Created new repository record: {repo.id}")
                except IntegrityError:
                    self.db.rollback()
                    repo = self.db.query(Repository).filter(
                        Repository.full_name == full_name
                    ).first()
                    if not repo:
                        raise
                    repo.url = canonical_url
                    repo.source_url = repo.source_url or repo_url
                    repo.last_synced = datetime.utcnow()
                    self.db.commit()
                    print(f"[2/6] Recovered existing repository record: {repo.id}")
            else:
                repo.full_name = repo.full_name or f"{owner}/{repo_name}"
                repo.url = canonical_url
                repo.source_url = repo_url
                repo.last_synced = datetime.utcnow()
                print(f"[2/6] Using existing repository record: {repo.id}")
            
            # Fetch PR data from GitHub (user token overrides env for this run)
            client = GitHubClient(token=github_token.strip() if github_token else None)
            print(f"[3/6] Fetching PRs from GitHub...")
            raw_prs = client.fetch_pull_requests(owner, repo_name, first=50)
            print(f"[3/6] Fetched {len(raw_prs)} PRs from GitHub")
            
            existing_count = self.db.query(PullRequest).filter(
                PullRequest.repo_id == repo.id
            ).count()

            if len(raw_prs) == 0:
                if existing_count > 0:
                    print(f"[INFO] No new PRs from API; using {existing_count} cached PRs")
                    self._update_contributor_stats(repo.id)
                    self._update_total_analysis(repo)
                    self.db.commit()
                    return {
                        "owner": owner,
                        "repo": repo_name,
                        "prs_processed": 0,
                        "repo_id": repo.id,
                        "total_prs": existing_count,
                    }
                raise Exception(
                    "No pull requests found. The repo may have no PRs yet, "
                    "or your GitHub token cannot access it."
                )
            
            # Process and store PRs
            pr_count = 0
            for idx, raw_pr in enumerate(raw_prs):
                try:
                    parsed_pr = client.parse_pr_data(raw_pr)
                    
                    # Check if PR exists
                    existing_pr = self.db.query(PullRequest).filter(
                        PullRequest.repo_id == repo.id,
                        PullRequest.pr_number == parsed_pr["number"]
                    ).first()
                    
                    if existing_pr:
                        existing_pr.repo_owner = owner
                        existing_pr.repo_name = repo_name
                        existing_pr.title = parsed_pr["title"][:200]
                        existing_pr.state = parsed_pr["state"]
                        existing_pr.merged_at = parsed_pr["merged_at"]
                        existing_pr.closed_at = parsed_pr["closed_at"]
                        existing_pr.commit_count = parsed_pr["commit_count"]
                        existing_pr.files_changed = parsed_pr["files_changed"]
                        existing_pr.lines_added = parsed_pr["lines_added"]
                        existing_pr.lines_deleted = parsed_pr["lines_deleted"]
                        existing_pr.review_count = parsed_pr["review_count"]
                        existing_pr.comment_count = parsed_pr["comment_count"]
                        existing_pr.cycle_time_days = parsed_pr["cycle_time_days"]
                        existing_pr.wait_for_review_hours = parsed_pr["wait_for_review_hours"]
                        existing_pr.review_duration_hours = parsed_pr["review_duration_hours"]
                    else:
                        pr = PullRequest(
                            repo_id=repo.id,
                            repo_owner=owner,
                            repo_name=repo_name,
                            pr_number=parsed_pr["number"],
                            title=parsed_pr["title"][:200],
                            state=parsed_pr["state"],
                            created_at=parsed_pr["created_at"],
                            merged_at=parsed_pr["merged_at"],
                            closed_at=parsed_pr["closed_at"],
                            commit_count=parsed_pr["commit_count"],
                            files_changed=parsed_pr["files_changed"],
                            lines_added=parsed_pr["lines_added"],
                            lines_deleted=parsed_pr["lines_deleted"],
                            review_count=parsed_pr["review_count"],
                            comment_count=parsed_pr["comment_count"],
                            author=parsed_pr["author"][:100],
                            cycle_time_days=parsed_pr["cycle_time_days"],
                            wait_for_review_hours=parsed_pr["wait_for_review_hours"],
                            review_duration_hours=parsed_pr["review_duration_hours"],
                        )
                        self.db.add(pr)
                        self.db.flush()
                        existing_pr = pr
                        pr_count += 1

                    self._generate_predictions_safe(existing_pr, parsed_pr)

                    if (idx + 1) % 10 == 0:
                        print(f"[4/6] Processed {idx + 1}/{len(raw_prs)} PRs...")
                except Exception as e:
                    print(f"[WARN] Error processing PR {raw_pr.get('number')}: {str(e)}")
                    continue
            
            print(f"[4/6] Stored {pr_count} new PRs in database")
            
            # Update contributor stats
            print(f"[5/6] Updating contributor statistics...")
            self._update_contributor_stats(repo.id, repo)
            self._update_total_analysis(repo)
            
            self.db.commit()
            print(f"[6/6] [SUCCESS] Successfully processed {pr_count} PRs for {owner}/{repo_name}")
            
            return {
                "owner": owner,
                "repo": repo_name,
                "prs_processed": pr_count,
                "repo_id": repo.id
            }
        except Exception as e:
            print(f"[FATAL ERROR] {str(e)}")
            self.db.rollback()
            raise
    
    def _update_total_analysis(self, repo: Repository):
        """Store or update aggregated analysis metrics for the repository."""
        prs = self.db.query(PullRequest).filter(PullRequest.repo_id == repo.id).all()
        total_prs = len(prs)
        open_prs = sum(1 for pr in prs if pr.state == "OPEN")
        merged_prs = sum(1 for pr in prs if pr.state == "MERGED")
        closed_prs = sum(1 for pr in prs if pr.state in ("MERGED", "CLOSED"))

        cycle_times = [pr.cycle_time_days for pr in prs if pr.cycle_time_days is not None]
        avg_cycle_time = round(sum(cycle_times) / len(cycle_times), 2) if cycle_times else 0.0

        review_durations = [pr.review_duration_hours for pr in prs if pr.review_duration_hours is not None]
        avg_review_duration = (
            round(sum(review_durations) / len(review_durations) / 24, 2)
            if review_durations
            else 0.0
        )

        wait_hours = [pr.wait_for_review_hours for pr in prs if pr.wait_for_review_hours is not None]
        avg_wait_for_review = (
            round(sum(wait_hours) / len(wait_hours) / 24, 2)
            if wait_hours
            else 0.0
        )

        merge_rate = round((merged_prs / closed_prs * 100) if closed_prs else 0, 2)

        now = datetime.now(timezone.utc)
        stale_pr_count = 0
        for pr in prs:
            if pr.state == "OPEN" and pr.created_at:
                created = pr.created_at
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                stale_pr_count += 1 if (now - created).days > 30 else 0

        analysis = self.db.query(TotalAnalysis).filter(
            TotalAnalysis.repo_id == repo.id
        ).first()

        if analysis:
            analysis.repo_owner = repo.owner
            analysis.repo_name = repo.name
            analysis.total_prs = total_prs
            analysis.open_prs = open_prs
            analysis.merged_prs = merged_prs
            analysis.closed_prs = closed_prs
            analysis.avg_cycle_time = avg_cycle_time
            analysis.merge_rate = merge_rate
            analysis.avg_review_duration = avg_review_duration
            analysis.avg_wait_for_review = avg_wait_for_review
            analysis.stale_pr_count = stale_pr_count
        else:
            analysis = TotalAnalysis(
                repo_id=repo.id,
                repo_owner=repo.owner,
                repo_name=repo.name,
                total_prs=total_prs,
                open_prs=open_prs,
                merged_prs=merged_prs,
                closed_prs=closed_prs,
                avg_cycle_time=avg_cycle_time,
                merge_rate=merge_rate,
                avg_review_duration=avg_review_duration,
                avg_wait_for_review=avg_wait_for_review,
                stale_pr_count=stale_pr_count,
            )
            self.db.add(analysis)

    def _compute_pr_ml_features(self, pr: PullRequest) -> Dict[str, list[float]]:
        """Create ML feature vectors from a stored PullRequest record."""
        age_days = 0.0
        if pr.created_at:
            created = pr.created_at
            if created.tzinfo is None:
                from datetime import timezone
                created = created.replace(tzinfo=timezone.utc)
            age_days = float((datetime.now(timezone.utc) - created).days)

        return {
            "delay_features": [
                float(pr.files_changed or 0),
                float(pr.commit_count or 0),
                float(pr.review_count or 0),
                float(pr.lines_added or 0),
                float(pr.lines_deleted or 0),
                float(pr.review_count or 0),
            ],
            "bottleneck_features": [
                float(pr.wait_for_review_hours or 0),
                float(pr.review_duration_hours or 0),
                float(pr.comment_count or 0),
                float(pr.commit_count or 0),
                float(age_days),
            ],
            "risk_features": [
                float(pr.comment_count or 0),
                float(pr.review_count or 0),
                float(pr.files_changed or 0),
                float((pr.lines_added or 0) + (pr.lines_deleted or 0)),
                0.5,
            ],
            "review_wait_features": [
                float(pr.review_count or 0),
                1.0,
                float(pr.files_changed or 0),
                0.0,
                1.0,
            ],
        }

    def _score_pr_with_ml(self, pr: PullRequest):
        """Create or refresh ML predictions for a stored PR."""
        ml_models = self._get_ml_models()
        if not ml_models:
            print(f"[ML SKIP] No ML models available for PR {pr.pr_number}")
            return None

        features = self._compute_pr_ml_features(pr)
        try:
            predicted_delay = float(ml_models.predict_delay(features["delay_features"]))
            bottleneck_prob = float(ml_models.predict_bottleneck(features["bottleneck_features"]))
            risk_score = float(ml_models.predict_risk(features["risk_features"]))
            predicted_review_wait = float(
                ml_models.predict_review_wait(features["review_wait_features"])
            )
        except Exception as exc:
            print(f"[ML ERROR] Prediction failed for PR {pr.pr_number}: {exc}")
            return None

        # Do not fall back to heuristic scores here. Use only ML model outputs.
        # If the ML models are unavailable or prediction fails, no prediction is stored.

        self.db.query(MLPrediction).filter(MLPrediction.pr_id == pr.id).delete(synchronize_session=False)
        prediction = MLPrediction(
            pr_id=pr.id,
            repo_owner=pr.repo_owner,
            repo_name=pr.repo_name,
            predicted_delay_days=predicted_delay,
            bottleneck_probability=bottleneck_prob,
            risk_score=risk_score,
            predicted_review_wait=predicted_review_wait,
        )
        self.db.add(prediction)
        print(f"[ML] Refreshed predictions for PR {pr.pr_number}")
        return prediction

    def refresh_ml_predictions(self, repo_id: int = None, only_open_prs: bool = True) -> int:
        """Refresh stored ML predictions for existing PRs in the database."""
        query = self.db.query(PullRequest)
        if repo_id is not None:
            query = query.filter(PullRequest.repo_id == repo_id)
        if only_open_prs:
            query = query.filter(PullRequest.state == "OPEN")
        prs = query.all()

        if not prs:
            print("[ML] No PRs found for prediction refresh.")
            return 0

        refreshed = 0
        for pr in prs:
            try:
                if self._score_pr_with_ml(pr) is not None:
                    refreshed += 1
            except Exception as exc:
                print(f"[ML WARNING] Could not refresh PR {pr.pr_number}: {exc}")
                continue

        self.db.commit()
        print(f"[ML] Refreshed predictions for {refreshed} PR(s)")
        return refreshed

    def _generate_predictions_safe(self, pr: PullRequest, parsed_pr: Dict):
        """Generate ML predictions safely - won't crash if ML fails"""
        try:
            ml_models = self._get_ml_models()
            if not ml_models:
                print(f"[ML SKIP] Skipping ML predictions for PR {pr.pr_number}")
                return
            
            # Prepare features with validation
            try:
                delay_features = [
                    float(parsed_pr.get("files_changed", 0) or 0),
                    float(parsed_pr.get("commit_count", 0) or 0),
                    float(parsed_pr.get("review_count", 0) or 0),
                    float(parsed_pr.get("lines_added", 0) or 0),
                    float(parsed_pr.get("lines_deleted", 0) or 0),
                    float(parsed_pr.get("reviewer_count", 0) or 0),
                ]
                
                # Calculate age safely
                from datetime import timezone
                now = datetime.now(timezone.utc)
                age_days = (now - pr.created_at).days if pr.state == "OPEN" else 0
                
                bottleneck_features = [
                    float(parsed_pr.get("wait_for_review_hours", 0) or 0),
                    float(parsed_pr.get("review_duration_hours", 0) or 0),
                    float(parsed_pr.get("comment_count", 0) or 0),
                    float(parsed_pr.get("commit_count", 0) or 0),
                    float(age_days),
                ]
                
                risk_features = [
                    float(parsed_pr.get("change_request_count", 0) or 0),
                    float(parsed_pr.get("review_count", 0) or 0),
                    float(parsed_pr.get("files_changed", 0) or 0),
                    float((parsed_pr.get("lines_added", 0) or 0) + (parsed_pr.get("lines_deleted", 0) or 0)),
                    0.5,
                ]
                
                review_wait_features = [
                    float(parsed_pr.get("reviewer_count", 0) or 0),
                    1.0,
                    float(parsed_pr.get("files_changed", 0) or 0),
                    0.0,
                    1.0,
                ]
                
                # Generate predictions
                predicted_delay = ml_models.predict_delay(delay_features)
                bottleneck_prob = ml_models.predict_bottleneck(bottleneck_features)
                risk_score = ml_models.predict_risk(risk_features)
                predicted_review_wait = ml_models.predict_review_wait(review_wait_features)
                
                # Validate predictions
                predicted_delay = float(predicted_delay) if predicted_delay else 0.0
                bottleneck_prob = float(bottleneck_prob) if bottleneck_prob else 0.0
                risk_score = float(risk_score) if risk_score else 0.0
                predicted_review_wait = float(predicted_review_wait) if predicted_review_wait else 0.0

                # Store predictions only from ML outputs.
                # Do not replace missing ML values with heuristic estimates.
                prediction = MLPrediction(
                    pr_id=pr.id,
                    repo_owner=pr.repo_owner,
                    repo_name=pr.repo_name,
                    predicted_delay_days=predicted_delay,
                    bottleneck_probability=bottleneck_prob,
                    risk_score=risk_score,
                    predicted_review_wait=predicted_review_wait,
                )
                self.db.add(prediction)
                print(f"[ML] Generated predictions for PR {pr.pr_number}")
                
            except Exception as e:
                print(f"[ML ERROR] Error preparing features for PR {pr.pr_number}: {str(e)}")
                # Continue without predictions
                
        except Exception as e:
            print(f"[ML ERROR] Error generating predictions: {str(e)}")
            # Don't crash - continue processing
    
    def _update_contributor_stats(self, repo_id: int, repo: Repository = None):
        """Update contributor statistics"""
        try:
            # Get repository if not provided
            if not repo:
                repo = self.db.query(Repository).filter(Repository.id == repo_id).first()
                if not repo:
                    print(f"[WARN] Repository {repo_id} not found for contributor stats")
                    return
            
            now = datetime.now(timezone.utc)
            
            prs = self.db.query(PullRequest).filter(
                PullRequest.repo_id == repo_id
            ).all()
            
            print(f"[STATS] Processing {len(prs)} PRs for contributor stats...")
            
            contributor_stats = {}
            for pr in prs:
                if not pr.author:
                    continue
                    
                if pr.author not in contributor_stats:
                    contributor_stats[pr.author] = {
                        "total_prs": 0,
                        "merged_prs": 0,
                        "cycle_times": [],
                        "review_times": [],
                        "stale_count": 0,
                    }
                
                contributor_stats[pr.author]["total_prs"] += 1
                
                if pr.state == "MERGED":
                    contributor_stats[pr.author]["merged_prs"] += 1
                    if pr.cycle_time_days and pr.cycle_time_days > 0:
                        contributor_stats[pr.author]["cycle_times"].append(pr.cycle_time_days)
                
                # Check if PR is stale (open for 30+ days)
                if pr.state == "OPEN" and pr.created_at:
                    created = pr.created_at
                    if created.tzinfo is None:
                        created = created.replace(tzinfo=timezone.utc)
                    else:
                        created = created.astimezone(timezone.utc)
                    age_days = (now - created).days
                    if age_days > 30:
                        contributor_stats[pr.author]["stale_count"] += 1
                
                if pr.review_duration_hours and pr.review_duration_hours > 0:
                    contributor_stats[pr.author]["review_times"].append(pr.review_duration_hours)
            
            # Store or update contributors
            for username, stats in contributor_stats.items():
                try:
                    contributor = self.db.query(Contributor).filter(
                        Contributor.repo_id == repo_id,
                        Contributor.username == username
                    ).first()
                    
                    avg_cycle = np.mean(stats["cycle_times"]) if stats["cycle_times"] else 0.0
                    avg_review = np.mean(stats["review_times"]) if stats["review_times"] else 0.0
                    
                    if contributor:
                        contributor.repo_owner = repo.owner
                        contributor.repo_name = repo.name
                        contributor.total_prs = stats["total_prs"]
                        contributor.merged_prs = stats["merged_prs"]
                        contributor.avg_cycle_time = float(avg_cycle)
                        contributor.avg_review_time = float(avg_review)
                        contributor.stale_pr_count = stats["stale_count"]
                    else:
                        contributor = Contributor(
                            repo_id=repo_id,
                            repo_owner=repo.owner,
                            repo_name=repo.name,
                            username=username[:100],
                            total_prs=stats["total_prs"],
                            merged_prs=stats["merged_prs"],
                            avg_cycle_time=float(avg_cycle),
                            avg_review_time=float(avg_review),
                            stale_pr_count=stats["stale_count"],
                        )
                        self.db.add(contributor)
                except Exception as e:
                    print(f"[WARN] Error updating contributor {username}: {str(e)}")
                    continue
            
            print(f"[STATS] Updated {len(contributor_stats)} contributors")
        except Exception as e:
            print(f"[WARN] Error updating contributor stats: {str(e)}")
