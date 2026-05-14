from fastapi import APIRouter
from app.api.v1.endpoints import institutions, accounts, upload, transactions, dashboard

api_router = APIRouter()

api_router.include_router(institutions.router, prefix="/institutions", tags=["기관"])
api_router.include_router(accounts.router, prefix="/accounts", tags=["계좌"])
api_router.include_router(upload.router, prefix="/upload", tags=["업로드"])
api_router.include_router(transactions.router, prefix="/transactions", tags=["거래내역"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["대시보드"])
