from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime
from typing import Optional

from app.models.models import Transaction, UploadHistory, Account, Institution
from app.services.file_parser import parse_bank_excel, parse_card_excel


def process_upload(
    db: Session,
    file_content: bytes,
    filename: str,
    institution_id: int,
    account_id: int,
    file_size: int,
) -> UploadHistory:
    institution = db.query(Institution).filter(Institution.id == institution_id).first()
    if not institution:
        raise ValueError(f"기관을 찾을 수 없습니다: {institution_id}")

    history = UploadHistory(
        institution_id=institution_id,
        account_id=account_id,
        filename=filename,
        file_size=file_size,
        status="processing",
    )
    db.add(history)
    db.commit()
    db.refresh(history)

    errors = []
    success_count = 0
    duplicate_count = 0
    error_count = 0

    try:
        if institution.type == "bank":
            transactions = parse_bank_excel(file_content, institution.name, account_id)
        else:
            transactions = parse_card_excel(file_content, institution.name, account_id)

        total = len(transactions)
        history.total_rows = total

        for tx_data in transactions:
            try:
                existing = db.query(Transaction).filter(
                    Transaction.hash_key == tx_data["hash_key"]
                ).first()

                if existing:
                    duplicate_count += 1
                    continue

                tx = Transaction(**tx_data)
                db.add(tx)
                db.flush()
                success_count += 1

            except IntegrityError:
                db.rollback()
                duplicate_count += 1
            except Exception as e:
                error_count += 1
                errors.append(str(e))

        db.commit()

        history.success_rows = success_count
        history.duplicate_rows = duplicate_count
        history.error_rows = error_count
        history.status = "completed"
        history.completed_at = datetime.utcnow()
        if errors:
            history.error_message = "; ".join(errors[:10])

    except Exception as e:
        history.status = "failed"
        history.error_message = str(e)
        db.rollback()

    db.add(history)
    db.commit()
    db.refresh(history)

    return history
