from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from app.db.session import get_db
from app.models.models import Institution
from app.schemas.schemas import InstitutionResponse

router = APIRouter()


@router.get("/", response_model=List[InstitutionResponse])
def get_institutions(db: Session = Depends(get_db)):
    return db.query(Institution).all()


@router.get("/{institution_id}", response_model=InstitutionResponse)
def get_institution(institution_id: int, db: Session = Depends(get_db)):
    return db.query(Institution).filter(Institution.id == institution_id).first()
