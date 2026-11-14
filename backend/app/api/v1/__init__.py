from fastapi import APIRouter

from app.api.v1 import analyses, auth, datasets, health, reports, users

router = APIRouter(prefix="/api/v1")
router.include_router(health.router)
router.include_router(auth.router)
router.include_router(users.router)
router.include_router(datasets.router)
router.include_router(analyses.router)
router.include_router(reports.router)
