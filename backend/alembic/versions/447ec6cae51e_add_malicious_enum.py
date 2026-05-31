"""add_malicious_enum

Revision ID: 447ec6cae51e
Revises: 29900a180462
Create Date: 2026-05-30 23:53:25.698476

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '447ec6cae51e'
down_revision: Union[str, None] = '29900a180462'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # Postgresql requires manual ALTER TYPE to add enum values
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE entitytype ADD VALUE IF NOT EXISTS 'MALICIOUS_RECORD'")

def downgrade() -> None:
    pass