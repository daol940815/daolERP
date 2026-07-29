from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List

from app.db.session import get_db
from app.models.models import UploadHistory, Account, Institution
from app.schemas.schemas import UploadResult, UploadHistoryResponse
from app.services.upload_service import process_upload

router = APIRouter()


@router.post("/", response_model=UploadResult)
async def upload_file(
    file: UploadFile = File(...),
    institution_id: int = Form(...),
    account_id: int = Form(...),
    db: Session = Depends(get_db),
):
    if not file.filename.endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다 (.xlsx, .xls, .csv)")

    content = await file.read()
    file_size = len(content)

    history = process_upload(
        db=db,
        file_content=content,
        filename=file.filename,
        institution_id=institution_id,
        account_id=account_id,
        file_size=file_size,
    )

    return UploadResult(
        upload_id=history.id,
        filename=history.filename,
        total_rows=history.total_rows,
        success_rows=history.success_rows,
        duplicate_rows=history.duplicate_rows,
        error_rows=history.error_rows,
        status=history.status,
    )


@router.get("/history", response_model=List[UploadHistoryResponse])
def get_upload_history(
    institution_id: int = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    query = db.query(UploadHistory).options(joinedload(UploadHistory.institution))
    if institution_id:
        query = query.filter(UploadHistory.institution_id == institution_id)
    return query.order_by(UploadHistory.uploaded_at.desc()).limit(limit).all()
