from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from app.db.session import get_db
from app.models.models import Account
from app.schemas.schemas import AccountCreate, AccountResponse

router = APIRouter()


@router.get("/", response_model=List[AccountResponse])
def get_accounts(
    institution_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    query = db.query(Account).options(joinedload(Account.institution))
    if institution_id:
        query = query.filter(Account.institution_id == institution_id)
    return query.filter(Account.is_active == True).all()


@router.post("/", response_model=AccountResponse)
def create_account(account: AccountCreate, db: Session = Depends(get_db)):
    db_account = Account(**account.model_dump())
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(account_id: int, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="계좌를 찾을 수 없습니다")
    return account
