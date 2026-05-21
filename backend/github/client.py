import os
import requests
import time
from typing import Dict, List, Any, Tuple
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

class GitHubClient:
    def __init__(self, token: str = None):
        self.token = token or os.getenv("GITHUB_TOKEN")
        self.base_url = "https://api.github.com/graphql"
        
        # Build headers - use token if available
        self.headers = {
            "Content-Type": "application/json"
        }
        if self.token:
            if self.token.startswith("github_pat_"):
                self.headers["Authorization"] = f"Bearer {self.token}"
            else:
                self.headers["Authorization"] = f"token {self.token}"
    
    def query(self, query: str, variables: Dict = None) -> Dict:
        """Execute GraphQL query with rate limit handling and retries"""
        payload = {"query": query}
        if variables:
            payload["variables"] = variables
        
        max_retries = 3
        backoff_delay = 5.0
        
        for attempt in range(max_retries):
            try:
                response = requests.post(self.base_url, json=payload, headers=self.headers, timeout=30)
                print(f"GitHub Client: Response status: {response.status_code}")
                
                # Check for rate limit status (403 or 429)
                if response.status_code in (403, 429):
                    # Check headers for reset time
                    reset_time_str = response.headers.get("X-RateLimit-Reset")
                    if reset_time_str:
                        try:
                            reset_time = float(reset_time_str)
                            sleep_dur = max(1.0, reset_time - time.time() + 2)
                            print(f"[Rate Limit] Limit reached. Sleeping for {sleep_dur:.1f} seconds...")
                            time.sleep(sleep_dur)
                            continue
                        except Exception:
                            pass
                    
                    print(f"[Rate Limit] 403/429 status. Backing off for {backoff_delay}s (Attempt {attempt+1}/{max_retries})...")
                    time.sleep(backoff_delay)
                    backoff_delay *= 2
                    continue
                
                if response.status_code == 401:
                    raise Exception("Bad credentials: GitHub token is invalid or expired")
                
                if response.status_code != 200:
                    print(f"GitHub Client: Non-200 response: {response.status_code}. Content: {response.text[:500]}")
                    if response.status_code in (500, 502, 503, 504, 408):
                        if attempt == max_retries - 1:
                            raise Exception(f"GitHub API error {response.status_code}: {response.text[:200]}")
                        print(f"Temporary server error. Retrying after {backoff_delay}s...")
                        time.sleep(backoff_delay)
                        backoff_delay *= 2
                        continue
                    raise Exception(f"GitHub API returned HTTP {response.status_code}: {response.text[:200]}")
                
                data = response.json()
                
                # Check for GraphQL errors related to rate limit / secondary rate limit
                if "errors" in data:
                    error_msg = str(data['errors'])
                    if "rate limit" in error_msg.lower() or "secondary" in error_msg.lower():
                        print(f"[Rate Limit] GraphQL rate limit error: {error_msg}. Retrying after sleep...")
                        time.sleep(backoff_delay)
                        backoff_delay *= 2
                        continue
                    print(f"GitHub API Error: {error_msg}")
                    raise Exception(f"GraphQL Error: {error_msg}")
                
                return data.get("data", {})
                
            except requests.exceptions.Timeout:
                print("GitHub Client: Request timeout")
                if attempt == max_retries - 1:
                    raise Exception("GitHub API request timed out. Try again later.")
                time.sleep(backoff_delay)
                backoff_delay *= 2
            except requests.exceptions.ConnectionError as e:
                print(f"GitHub Client: Connection error: {str(e)}")
                if attempt == max_retries - 1:
                    raise Exception("Connection error to GitHub API. Check your internet connection.")
                time.sleep(backoff_delay)
                backoff_delay *= 2
            except Exception as e:
                print(f"GitHub Client: Error: {str(e)}")
                raise
    
    def verify_repository_access(self, owner: str, repo: str) -> Dict[str, Any]:
        """Verify repository access and check if it is private"""
        query = """
        query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
                isPrivate
                name
                owner {
                    login
                }
            }
        }
        """
        variables = {"owner": owner, "repo": repo}
        try:
            data = self.query(query, variables)
            repo_data = data.get("repository")
            if not repo_data:
                raise Exception("Could not resolve to a Repository.")
            return {
                "ok": True,
                "is_private": repo_data.get("isPrivate", False),
                "owner": repo_data.get("owner", {}).get("login", owner),
                "repo": repo_data.get("name", repo)
            }
        except Exception as e:
            print(f"GitHub Client: Error verifying repository: {str(e)}")
            raise

    def fetch_pull_requests(
        self, owner: str, repo: str, first: int = 50, cursor: str = None
    ) -> Tuple[List[Dict], Dict, Dict]:
        """Fetch a page of PRs with reviews and commits, plus rate limit info."""
        query = """
        query($owner: String!, $repo: String!, $first: Int!, $cursor: String) {
            rateLimit {
                limit
                remaining
                resetAt
            }
            repository(owner: $owner, name: $repo) {
                pullRequests(first: $first, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                    nodes {
                        number
                        title
                        state
                        createdAt
                        updatedAt
                        mergedAt
                        closedAt
                        commits(first: 1) {
                            totalCount
                        }
                        files(first: 50) {
                            totalCount
                            nodes {
                                additions
                                deletions
                            }
                        }
                        reviews(first: 50) {
                            totalCount
                            nodes {
                                state
                                submittedAt
                                author {
                                    login
                                }
                            }
                        }
                        comments(first: 1) {
                            totalCount
                        }
                        author {
                            login
                        }
                    }
                }
            }
        }
        """
        variables = {"owner": owner, "repo": repo, "first": first, "cursor": cursor}
        try:
            data = self.query(query, variables)
            rate_limit = data.get("rateLimit", {})
            
            repo_data = data.get("repository")
            if not repo_data:
                raise Exception(
                    "Could not resolve to a Repository. Check the URL is correct "
                    "(https://github.com/owner/repo) and your token can access it."
                )
            
            conn = repo_data.get("pullRequests", {})
            prs = conn.get("nodes", [])
            page_info = conn.get("pageInfo", {"hasNextPage": False, "endCursor": None})
            return prs or [], page_info, rate_limit
        except Exception as e:
            print(f"GitHub Client: Error fetching PRs: {str(e)}")
            raise
    
    def parse_pr_data(self, pr: Dict) -> Dict:
        """Parse raw PR data into structured format"""
        try:
            if not pr:
                raise ValueError("PR data is None")
            
            # Parse dates with timezone info - handle None values
            created_at_str = pr.get("createdAt")
            if not created_at_str:
                raise ValueError("PR missing createdAt")
            
            created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
            
            updated_at_str = pr.get("updatedAt")
            updated_at = None
            if updated_at_str:
                updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
            
            merged_at = pr.get("mergedAt")
            if merged_at:
                merged_at = datetime.fromisoformat(merged_at.replace("Z", "+00:00"))
            
            closed_at = pr.get("closedAt")
            if closed_at:
                closed_at = datetime.fromisoformat(closed_at.replace("Z", "+00:00"))
            
            # Calculate cycle time (fractional days for sub-day merges)
            cycle_time_days = None
            if merged_at:
                cycle_time_days = (merged_at - created_at).total_seconds() / 86400
            
            # Calculate review metrics - handle None reviews
            reviews_data = pr.get("reviews")
            reviews = []
            if reviews_data and isinstance(reviews_data, dict):
                reviews = reviews_data.get("nodes", []) or []
            
            first_review_time = None
            last_review_time = None
            approval_count = 0
            change_request_count = 0
            
            for review in reviews:
                if review and review.get("submittedAt"):
                    review_time = datetime.fromisoformat(review["submittedAt"].replace("Z", "+00:00"))
                    if not first_review_time or review_time < first_review_time:
                        first_review_time = review_time
                    if not last_review_time or review_time > last_review_time:
                        last_review_time = review_time
                    
                    if review.get("state") == "APPROVED":
                        approval_count += 1
                    elif review.get("state") == "CHANGES_REQUESTED":
                        change_request_count += 1
            
            wait_for_review_hours = None
            if first_review_time:
                wait_for_review_hours = (first_review_time - created_at).total_seconds() / 3600
            
            review_duration_hours = None
            if first_review_time and last_review_time:
                review_duration_hours = (last_review_time - first_review_time).total_seconds() / 3600
            
            # Calculate file changes - handle None files
            files_data = pr.get("files")
            files = []
            if files_data and isinstance(files_data, dict):
                files = files_data.get("nodes", []) or []
            
            lines_added = sum(f.get("additions", 0) for f in files if f)
            lines_deleted = sum(f.get("deletions", 0) for f in files if f)
            
            # Get author safely
            author_data = pr.get("author")
            author = "unknown"
            if author_data and isinstance(author_data, dict):
                author = author_data.get("login", "unknown")
            
            # Get commits safely
            commits_data = pr.get("commits")
            commit_count = 0
            if commits_data and isinstance(commits_data, dict):
                commit_count = commits_data.get("totalCount", 0) or 0
            
            # Get files count safely
            files_count = 0
            if files_data and isinstance(files_data, dict):
                files_count = files_data.get("totalCount", 0) or 0
            
            # Get reviews count safely
            reviews_count = 0
            if reviews_data and isinstance(reviews_data, dict):
                reviews_count = reviews_data.get("totalCount", 0) or 0
            
            # Get comments safely
            comments_data = pr.get("comments")
            comment_count = 0
            if comments_data and isinstance(comments_data, dict):
                comment_count = comments_data.get("totalCount", 0) or 0
            
            return {
                "number": pr.get("number", 0),
                "title": pr.get("title", ""),
                "state": pr.get("state", "UNKNOWN"),
                "created_at": created_at,
                "updated_at": updated_at,
                "merged_at": merged_at,
                "closed_at": closed_at,
                "commit_count": commit_count,
                "files_changed": files_count,
                "lines_added": lines_added,
                "lines_deleted": lines_deleted,
                "review_count": reviews_count,
                "comment_count": comment_count,
                "author": author,
                "cycle_time_days": cycle_time_days,
                "wait_for_review_hours": wait_for_review_hours,
                "review_duration_hours": review_duration_hours,
                "approval_count": approval_count,
                "change_request_count": change_request_count,
                "reviewer_count": len(set(r.get("author", {}).get("login") for r in reviews if r and r.get("author"))),
            }
        except Exception as e:
            print(f"Error parsing PR data: {str(e)}")
            raise
