"""add deterministic payment assessments and boss decision events

Revision ID: 20260705_0002
Revises: 20260702_0001
"""

from alembic import op
import sqlalchemy as sa


revision = "20260705_0002"
down_revision = "20260702_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payment_assessment",
        sa.Column("planned_expense_id", sa.Uuid(), nullable=False),
        sa.Column("as_of_date", sa.Date(), nullable=False),
        sa.Column("import_batch_id", sa.Uuid(), nullable=False),
        sa.Column("rule_version", sa.String(32), nullable=False),
        sa.Column("queue_order", sa.Integer()),
        sa.Column("eligibility_result", sa.String(24), nullable=False),
        sa.Column("decision", sa.String(24), nullable=False),
        sa.Column("reason_codes", sa.JSON(), nullable=False),
        sa.Column("min_balance_before", sa.Numeric(18, 2)),
        sa.Column("min_balance_after", sa.Numeric(18, 2)),
        sa.Column("gap_before", sa.Numeric(18, 2)),
        sa.Column("gap_after", sa.Numeric(18, 2)),
        sa.Column("gap_increase", sa.Numeric(18, 2)),
        sa.Column("gap_date", sa.Date()),
        sa.Column("recovery_date", sa.Date()),
        sa.Column("evidence_snapshot", sa.JSON(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["planned_expense_id"], ["planned_expense.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["import_batch_id"], ["import_batch.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("planned_expense_id", "as_of_date", "import_batch_id", "rule_version"),
    )
    op.create_index("ix_payment_assessment_planned_expense_id", "payment_assessment", ["planned_expense_id"])
    op.create_index("ix_payment_assessment_import_batch_id", "payment_assessment", ["import_batch_id"])
    op.create_index("ix_payment_assessment_batch_date_decision", "payment_assessment", ["import_batch_id", "as_of_date", "decision"])

    op.create_table(
        "decision_event",
        sa.Column("business_key", sa.String(160), nullable=False),
        sa.Column("event_key", sa.String(180), nullable=False),
        sa.Column("risk_cycle_no", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("source_task_id", sa.Uuid()),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("risk_level", sa.String(16), nullable=False),
        sa.Column("impact_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("impact_date", sa.Date()),
        sa.Column("owner_code", sa.String(64)),
        sa.Column("owner_name", sa.String(100)),
        sa.Column("reason_codes", sa.JSON(), nullable=False),
        sa.Column("evidence_snapshot", sa.JSON(), nullable=False),
        sa.Column("allowed_options", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("selected_option", sa.String(40)),
        sa.Column("decision_note", sa.String(1000)),
        sa.Column("decision_payload", sa.JSON()),
        sa.Column("decided_by", sa.String(100)),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("closed_reason", sa.String(200)),
        sa.Column("import_batch_id", sa.Uuid(), nullable=False),
        sa.Column("rule_version", sa.String(32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["import_batch_id"], ["import_batch.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_key"),
    )
    op.create_index("ix_decision_event_business_key", "decision_event", ["business_key"])
    op.create_index("ix_decision_event_import_batch_id", "decision_event", ["import_batch_id"])
    op.create_index("ix_decision_event_status_risk_date", "decision_event", ["status", "risk_level", "impact_date"])


def downgrade() -> None:
    op.drop_table("decision_event")
    op.drop_table("payment_assessment")
