"""Merge feedback tables and quiz taker_email heads.

Revision ID: merge_feedback_and_quiz_heads
Revises: add_rag_feedback_tables, add_taker_email_to_quiz_attempts
Create Date: 2026-02-28

Merge migration to resolve dual heads after parallel development of
rag_feedback_tables and add_taker_email_to_quiz_attempts.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'merge_feedback_and_quiz_heads'
down_revision: Union[str, Sequence[str]] = (
    'add_rag_feedback_tables',
    'add_taker_email_to_quiz_attempts',
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
