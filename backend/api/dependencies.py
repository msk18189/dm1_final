"""FastAPI dependency injection for authentication and authorization.

Provides:
- get_current_user: decode JWT → return User or 401
- get_current_user_optional: return User or None (public endpoints)
- require_repo_access: validate user can access a given repo
"""
from typing import Optional
from fastapi import Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session

from database.database import get_db
from database.models import User, UserRepository, Repository
from api.auth import decode_access_token

def _extract_user(request: Request, authorization: Optional[str], db: Session) -> Optional[User]:
    """Decode bearer token and return User object, or None."""
    token = request.cookies.get("accessToken")
    
    if not token and authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
            
    if not token:
        return None
        
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        return None
    user = db.query(User).filter(User.username == payload["sub"]).first()
    return user


def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """Require authenticated user — raises 401 if not valid."""
    user = _extract_user(request, authorization, db)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def get_current_user_optional(
    request: Request,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Return authenticated user or None — for endpoints that work both ways."""
    return _extract_user(request, authorization, db)


def require_repo_access(
    repo_id: int,
    user: Optional[User],
    db: Session,
) -> Repository:
    """Validate that a user can access the given repository.

    Rules:
    - Public repos: accessible by anyone
    - Private repos: only accessible by associated users (UserRepository)

    Returns the Repository object or raises 403/404.
    """
    repo = db.query(Repository).filter(Repository.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    # Public repos are accessible by anyone
    visibility = getattr(repo, "visibility", "public") or "public"
    if visibility == "public":
        return repo

    # Private repos require auth + association
    if not user:
        raise HTTPException(
            status_code=403,
            detail="Authentication required to access private repositories",
        )

    assoc = db.query(UserRepository).filter(
        UserRepository.user_id == user.id,
        UserRepository.repo_id == repo.id,
    ).first()

    if not assoc:
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this private repository",
        )

    return repo
