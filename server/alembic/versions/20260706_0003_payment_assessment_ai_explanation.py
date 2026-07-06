"""add payment assessment ai explanation

Revision ID: 20260706_0003
Revises: 20260705_0002
"""

from alembic import op
import sqlalchemy as sa


revision = "20260706_0003"
down_revision = "20260705_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payment_assessment", sa.Column("ai_explanation", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("payment_assessment", "ai_explanation")
