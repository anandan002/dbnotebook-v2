"""Add taker_email to quiz_attempts.

Revision ID: add_taker_email_to_quiz_attempts
Revises: add_quiz_extended_fields
Create Date: 2026-02-27
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "add_taker_email_to_quiz_attempts"
down_revision: Union[str, Sequence[str], None] = "add_quiz_extended_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing_columns = {c["name"] for c in inspector.get_columns("quiz_attempts")}
    if "taker_email" not in existing_columns:
        op.add_column(
            "quiz_attempts",
            sa.Column("taker_email", sa.String(length=255), nullable=True),
        )

    existing_indexes = {i["name"] for i in inspector.get_indexes("quiz_attempts")}
    if "idx_quiz_attempts_email" not in existing_indexes:
        op.create_index(
            "idx_quiz_attempts_email",
            "quiz_attempts",
            ["taker_email"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing_indexes = {i["name"] for i in inspector.get_indexes("quiz_attempts")}
    if "idx_quiz_attempts_email" in existing_indexes:
        op.drop_index("idx_quiz_attempts_email", table_name="quiz_attempts")

    existing_columns = {c["name"] for c in inspector.get_columns("quiz_attempts")}
    if "taker_email" in existing_columns:
        op.drop_column("quiz_attempts", "taker_email")
