import os
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import create_engine, String, JSON, Integer, ForeignKey, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

DATA_DIR = Path(os.environ.get('CLIPFORGE_DATA_DIR', 'data')).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.environ.get('DATABASE_URL', f'sqlite:///{DATA_DIR / "clipforge.db"}')
engine = create_engine(DATABASE_URL, connect_args={'check_same_thread': False} if DATABASE_URL.startswith('sqlite') else {})
if DATABASE_URL.startswith('sqlite'):
    @event.listens_for(engine, 'connect')
    def configure_sqlite(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute('PRAGMA busy_timeout=10000')

Session = sessionmaker(engine, expire_on_commit=False)


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class ProjectRow(Base):
    __tablename__ = 'projects'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    data: Mapped[dict] = mapped_column(JSON)


class MediaRow(Base):
    __tablename__ = 'media_assets'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id', ondelete='CASCADE'), index=True)
    data: Mapped[dict] = mapped_column(JSON)


class ClipRow(Base):
    __tablename__ = 'clips'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id', ondelete='CASCADE'), index=True)
    data: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=0)


class EditRevisionRow(Base):
    __tablename__ = 'edit_revisions'
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    clip_id: Mapped[str] = mapped_column(ForeignKey('clips.id', ondelete='CASCADE'), index=True)
    data: Mapped[dict] = mapped_column(JSON)


class JobRow(Base):
    __tablename__ = 'processing_jobs'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    data: Mapped[dict] = mapped_column(JSON)


class CampaignRow(Base):
    __tablename__ = 'campaigns'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    data: Mapped[dict] = mapped_column(JSON)


class SettingsRow(Base):
    __tablename__ = 'user_settings'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default='personal')
    data: Mapped[dict] = mapped_column(JSON)
