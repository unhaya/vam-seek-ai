"""
VAM Web MVP - FastAPI Backend
2Dシークマーカーの核心ロジックをAPI化

元コード: vam5.70/utils/video_utils.py の calculate_x_continuous_timestamp を1ミリも狂わず移植
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from routers import grid_router, video_router
from routers.video import init_dirs

app = FastAPI(
    title="VAM Web API",
    description="2Dシークマーカー - グリッド座標からタイムスタンプを計算",
    version="0.1.0"
)

# 作業ディレクトリの設定
UPLOAD_DIR = Path(__file__).parent / "uploads"
THUMBNAIL_DIR = Path(__file__).parent / "thumbnails"
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
UPLOAD_DIR.mkdir(exist_ok=True)
THUMBNAIL_DIR.mkdir(exist_ok=True)

# ルーターにディレクトリを設定
init_dirs(UPLOAD_DIR, THUMBNAIL_DIR)

# 静的ファイル配信設定（動画・サムネイル）
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.mount("/thumbnails", StaticFiles(directory=str(THUMBNAIL_DIR)), name="thumbnails")

# フロントエンドの静的ファイル（assets等）
app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーター登録
app.include_router(grid_router)
app.include_router(video_router)


@app.get("/")
async def root():
    """フロントエンドのindex.htmlを配信"""
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/info")
async def api_info():
    """API情報 - 動作確認用"""
    return {
        "message": "VAM Web API - 2Dシークマーカー",
        "version": "0.1.0",
        "endpoints": [
            "/api/grid/position - グリッド位置からタイムスタンプを計算",
            "/api/grid/config - グリッド設定を計算",
            "/api/video/upload - 動画アップロード",
            "/api/video/thumbnails - サムネイル生成"
        ]
    }


@app.get("/api/health")
async def health_check():
    """ヘルスチェック"""
    return {"status": "healthy", "service": "VAM Web API"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
