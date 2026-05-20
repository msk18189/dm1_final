import os
import requests
from typing import Dict, List, Any
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
        """Execute GraphQL query"""
        payload = {"query": query}
        if variables:
            payload["variables"] = variables
        
        try:
            response = requests.post(self.base_url, json=payload, headers=self.headers, timeout=30)
            print(f"GitHub Client: Response status: {response.status_code}")
            
            if response.status_code == 401:
                raise Exception("Bad credentials: GitHub token is invalid or expired")
            if response.status_code == 403:
                body = response.json() if response.content else {}
                message = body.get("message", "GitHub API rate limit or missing token")
                if not self.token:
                    raise Exception(
                        "GitHub API access denied. Set GITHUB_TOKEN in backend/.env"
                    )
                raise Exception(f"GitHub API forbidden: {message}")
            
            data = response.json()
            print(f"GitHub Client: Response keys: {data.keys()}")
            
            if "message" in data and "errors" not in data:
                raise Exception(f"GitHub API error: {data['message']}")
            
            if "errors" in data:
                error_msg = str(data['errors'])
                print(f"GitHub API Error: {error_msg}")
                raise Exception(f"GraphQL Error: {error_msg}")
            
            return data.get("data", {})
        except requests.exceptions.Timeout:
            print("GitHub Client: Request timeout - GitHub API took too long")
            raise Exception("GitHub API request timed out. Try again later.")
        except requests.exceptions.ConnectionError as e:
            print(f"GitHub Client: Connection error: {str(e)}")
            raise Exception("Connection error to GitHub API. Check your internet connection.")
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

    def fetch_pull_requests(self, owner: str, repo: str, first: int = 50) -> List[Dict]:
        """Fetch PRs with reviews and commits - simplified query"""
        query = """
        query($owner: String!, $repo: String!, $first: Int!) {
            repository(owner: $owner, name: $repo) {
                pullRequests(first: $first, orderBy: {field: CREATED_AT, direction: DESC}) {
                    nodes {
                        number
                        title
                        state
                        createdAt
                        mergedAt
                        closedAt
                        commits(first: 5) {
                            totalCount
                        }
                        files(first: 5) {
                            totalCount
                            nodes {
                                additions
                                deletions
                            }
                        }
                        reviews(first: 5) {
                            totalCount
                            nodes {
                                state
                                submittedAt
                                author {
                                    login
                                }
                            }
                        }
                        comments(first: 3) {
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
        
        variables = {"owner": owner, "repo": repo, "first": first}
        try:
            data = self.query(query, variables)
            print(f"GitHub Client: Query response data keys: {data.keys()}")
            
            repo_data = data.get("repository")
            if not repo_data:
                raise Exception(
                    "Could not resolve to a Repository. Check the URL is correct "
                    "(https://github.com/owner/repo) and your token can access it."
                )
            
            prs = repo_data.get("pullRequests", {}).get("nodes", [])
            print(f"GitHub Client: Found {len(prs)} PRs")
            return prs or []
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
