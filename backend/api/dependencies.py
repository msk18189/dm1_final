"""FastAPI dependency injection for authentication and authorization.

Provides:
- get_current_user: decode JWT → return User or 401
- get_current_user_optional: return User or None (public endpoints)
- require_repo_access: validate user can access a given repo
"""
from typing import Optional
<<<<<<< HEAD
from fastapi import Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session
=======
from fastapi import Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
>>>>>>> ebd3b1d191540a57d1bba0df0b233989f7145041

from database.database import get_db
from database.models import User, UserRepository, Repository
from api.auth import decode_access_token

<<<<<<< HEAD
def _extract_user(request: Request, authorization: Optional[str], db: Session) -> Optional[User]:
=======
async def _extract_user(authorization: Optional[str], db: AsyncSession) -> Optional[User]:
>>>>>>> ebd3b1d191540a57d1bba0df0b233989f7145041
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
    
    result = await db.execute(
        select(User).where(User.username == payload["sub"])
    )
    return result.scalar_one_or_none()


<<<<<<< HEAD
def get_current_user(
    request: Request,
=======
async def get_current_user(
>>>>>>> ebd3b1d191540a57d1bba0df0b233989f7145041
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Require authenticated user — raises 401 if not valid."""
<<<<<<< HEAD
    user = _extract_user(request, authorization, db)
=======
    user = await _extract_user(authorization, db)
>>>>>>> ebd3b1d191540a57d1bba0df0b233989f7145041
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


<<<<<<< HEAD
def get_current_user_optional(
    request: Request,
=======
async def get_current_user_optional(
>>>>>>> ebd3b1d191540a57d1bba0df0b233989f7145041
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """Return authenticated user or None — for endpoints that work both ways."""
<<<<<<< HEAD
    return _extract_user(request, authorization, db)
=======
    return await _extract_user(authorization, db)
>>>>>>> ebd3b1d191540a57d1bba0df0b233989f7145041


async def require_repo_access(
    repo_id: int,
    user: Optional[User],
    db: AsyncSession,
) -> Repository:
    """Validate that a user can access the given repository.

    Rules:
    - Public repos: accessible by anyone
    - Private repos: only accessible by associated users (UserRepository)

    Returns the Repository object or raises 403/404.
    """
    result = await db.execute(
        select(Repository).where(Repository.id == repo_id)
    )
    repo = result.scalar_one_or_none()
    
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
