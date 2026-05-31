"""add_port_enum

Revision ID: 29900a180462
Revises: ae2878296ba5
Create Date: 2026-05-30 23:03:00.938333

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '29900a180462'
down_revision: Union[str, None] = 'ae2878296ba5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # Postgresql requires manual ALTER TYPE to add enum values
    # We use IF NOT EXISTS to prevent errors if it was already added
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE entitytype ADD VALUE IF NOT EXISTS 'PORT'")

def downgrade() -> None:
    # Downgrading enum values in Postgres is complex and generally avoided
    pass