"""
Conversation Store for Persistent Conversation History

Provides conversation persistence with PostgreSQL for notebook-scoped chat history.
"""

import logging
from typing import Dict, List, Optional
from datetime import datetime
from uuid import UUID, uuid4

from ..db import DatabaseManager
from ..db.models import Conversation

logger = logging.getLogger(__name__)


class ConversationStore:
    """
    Manages persistent conversation history with database persistence.

    Features:
    - Save and retrieve conversation messages
    - Notebook-scoped conversation history
    - User-specific conversation tracking
    - Automatic timestamp management
    - Message count and activity tracking
    """

    def __init__(self, db_manager: DatabaseManager):
        """
        Initialize conversation store with database connection.

        Args:
            db_manager: DatabaseManager instance for database operations
        """
        self.db = db_manager
        logger.info("ConversationStore initialized")

    # =========================================================================
    # Message Persistence Operations
    # =========================================================================

    def save_message(
        self,
        notebook_id: str,
        user_id: str,
        role: str,
        content: str,
        session_id: Optional[str] = None,
    ) -> str:
        """
        Save a single conversation message.

        Args:
            notebook_id: UUID of the notebook
            user_id: UUID of the user
            role: Message role ('user' or 'assistant')
            content: Message content text

        Returns:
            conversation_id (UUID) of the saved message

        Raises:
            ValueError: If role is not 'user' or 'assistant'
            Exception: For database errors
        """
        if role not in ['user', 'assistant']:
            raise ValueError(f"Invalid role: {role}. Must be 'user' or 'assistant'")

        try:
            with self.db.get_session() as session:
                conversation = Conversation(
                    conversation_id=uuid4(),
                    notebook_id=UUID(notebook_id),
                    user_id=UUID(user_id),
                    session_id=UUID(session_id) if session_id else None,
                    role=role,
                    content=content
                )

                session.add(conversation)
                session.flush()

                logger.debug(
                    f"Saved message to notebook {notebook_id}: "
                    f"{role} - {len(content)} chars"
                )

                return str(conversation.conversation_id)

        except ValueError:
            raise
        except Exception as e:
            logger.error(f"Failed to save message: {e}")
            raise

    def save_messages(
        self,
        notebook_id: str,
        user_id: str,
        messages: List[Dict],
        session_id: Optional[str] = None,
    ) -> List[str]:
        """
        Save multiple conversation messages in batch.

        Args:
            notebook_id: UUID of the notebook
            user_id: UUID of the user
            messages: List of message dicts with 'role' and 'content' keys

        Returns:
            List of conversation_ids (UUIDs) of saved messages

        Raises:
            ValueError: If any message has invalid role
            Exception: For database errors
        """
        conversation_ids = []

        try:
            with self.db.get_session() as session:
                for msg in messages:
                    role = msg.get('role')
                    content = msg.get('content')

                    if role not in ['user', 'assistant']:
                        raise ValueError(f"Invalid role: {role}. Must be 'user' or 'assistant'")

                    conversation = Conversation(
                        conversation_id=uuid4(),
                        notebook_id=UUID(notebook_id),
                        user_id=UUID(user_id),
                        session_id=UUID(session_id) if session_id else None,
                        role=role,
                        content=content
                    )

                    session.add(conversation)
                    conversation_ids.append(str(conversation.conversation_id))

                session.flush()

                logger.info(
                    f"Saved {len(messages)} messages to notebook {notebook_id}"
                )

                return conversation_ids

        except ValueError:
            raise
        except Exception as e:
            logger.error(f"Failed to save messages: {e}")
            raise

    # =========================================================================
    # Conversation Retrieval Operations
    # =========================================================================

    def get_conversation_history(
        self,
        notebook_id: str,
        user_id: str,
        limit: int = 50,
        offset: int = 0,
        session_id: Optional[str] = None,
    ) -> List[Dict]:
        """
        Retrieve conversation history for a notebook.

        Args:
            notebook_id: UUID of the notebook
            user_id: UUID of the user
            limit: Maximum number of messages to retrieve (default: 50)
            offset: Number of messages to skip (default: 0)

        Returns:
            List of conversation messages ordered by timestamp (oldest first)
            Each message is a dict with: conversation_id, role, content, timestamp
        """
        try:
            with self.db.get_session() as session:
                query = session.query(Conversation).filter(
                    Conversation.notebook_id == UUID(notebook_id),
                    Conversation.user_id == UUID(user_id)
                )

                if session_id:
                    query = query.filter(Conversation.session_id == UUID(session_id))

                conversations = (
                    query.order_by(Conversation.timestamp.desc())
                    .offset(offset)
                    .limit(limit)
                    .all()
                )
                conversations = list(reversed(conversations))

                result = []
                for conv in conversations:
                    result.append({
                        "conversation_id": str(conv.conversation_id),
                        "role": conv.role,
                        "content": conv.content,
                        "session_id": str(conv.session_id) if conv.session_id else None,
                        "timestamp": conv.timestamp.isoformat() if conv.timestamp else None
                    })

                logger.debug(
                    f"Retrieved {len(result)} messages from notebook {notebook_id}"
                )

                return result

        except Exception as e:
            logger.error(f"Failed to retrieve conversation history: {e}")
            raise

    # =========================================================================
    # History Management Operations
    # =========================================================================

    def clear_notebook_history(self, notebook_id: str) -> bool:
        """
        Clear all conversation history for a notebook.

        Args:
            notebook_id: UUID of the notebook

        Returns:
            True if cleared successfully, False if no messages found
        """
        try:
            with self.db.get_session() as session:
                deleted_count = session.query(Conversation).filter(
                    Conversation.notebook_id == UUID(notebook_id)
                ).delete()

                if deleted_count > 0:
                    logger.info(
                        f"Cleared {deleted_count} messages from notebook {notebook_id}"
                    )
                    return True
                else:
                    logger.warning(f"No conversation history found for notebook {notebook_id}")
                    return False

        except Exception as e:
            logger.error(f"Failed to clear notebook history: {e}")
            raise

    def clear_user_history(self, user_id: str) -> bool:
        """
        Clear all conversation history for a user across all notebooks.

        Args:
            user_id: UUID of the user

        Returns:
            True if cleared successfully, False if no messages found
        """
        try:
            with self.db.get_session() as session:
                deleted_count = session.query(Conversation).filter(
                    Conversation.user_id == UUID(user_id)
                ).delete()

                if deleted_count > 0:
                    logger.info(
                        f"Cleared {deleted_count} messages for user {user_id}"
                    )
                    return True
                else:
                    logger.warning(f"No conversation history found for user {user_id}")
                    return False

        except Exception as e:
            logger.error(f"Failed to clear user history: {e}")
            raise

    # =========================================================================
    # Statistics and Utilities
    # =========================================================================

    def get_message_count(self, notebook_id: str) -> int:
        """
        Get count of messages in a notebook.

        Args:
            notebook_id: UUID of the notebook

        Returns:
            Number of messages in the notebook
        """
        try:
            with self.db.get_session() as session:
                count = session.query(Conversation).filter(
                    Conversation.notebook_id == UUID(notebook_id)
                ).count()

                logger.debug(f"Notebook {notebook_id} has {count} messages")
                return count

        except Exception as e:
            logger.error(f"Failed to get message count: {e}")
            raise

    def get_last_activity(self, notebook_id: str) -> Optional[datetime]:
        """
        Get timestamp of last message in notebook.

        Args:
            notebook_id: UUID of the notebook

        Returns:
            Datetime of last message, or None if no messages
        """
        try:
            with self.db.get_session() as session:
                last_conversation = session.query(Conversation).filter(
                    Conversation.notebook_id == UUID(notebook_id)
                ).order_by(Conversation.timestamp.desc()).first()

                if last_conversation:
                    logger.debug(
                        f"Last activity in notebook {notebook_id}: "
                        f"{last_conversation.timestamp}"
                    )
                    return last_conversation.timestamp
                else:
                    logger.debug(f"No activity found in notebook {notebook_id}")
                    return None

        except Exception as e:
            logger.error(f"Failed to get last activity: {e}")
            raise
