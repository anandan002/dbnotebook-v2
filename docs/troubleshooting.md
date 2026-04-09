# Troubleshooting Guide

Solutions for common issues in DBNotebook.

---

## Installation Issues

### PostgreSQL Connection Failed

**Symptoms**: `connection refused` or `FATAL: role does not exist`

**Solutions**:

1. **Check PostgreSQL is running**:
   ```bash
   # macOS
   brew services list | grep postgresql

   # Linux
   sudo systemctl status postgresql
   ```

2. **Create database and user**:
   ```bash
   createdb dbnotebook_dev
   createuser -P dbnotebook  # Set password when prompted
   ```

3. **Grant permissions**:
   ```sql
   GRANT ALL PRIVILEGES ON DATABASE dbnotebook_dev TO dbnotebook;
   ```

4. **Check connection string**:
   ```bash
   # Test connection
   psql postgresql://dbnotebook:dbnotebook@localhost:5432/dbnotebook_dev
   ```

---

### pgvector Extension Missing

**Symptoms**: `extension "vector" does not exist`

**Solutions**:

```bash
# macOS
brew install pgvector

# Ubuntu/Debian
sudo apt install postgresql-17-pgvector

# Then enable in database
psql -d dbnotebook_dev -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

---

### Python Dependencies Failed

**Symptoms**: `ModuleNotFoundError` or pip install errors

**Solutions**:

1. **Use Python 3.11+**:
   ```bash
   python3 --version  # Should be 3.11 or higher
   ```

2. **Create fresh virtual environment**:
   ```bash
   rm -rf venv
   python3 -m venv venv
   source venv/bin/activate
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

3. **For Apple Silicon Macs**:
   ```bash
   # Some packages need Rosetta
   arch -x86_64 pip install package-name
   ```

4. **For Windows resolver conflicts (`ResolutionImpossible`)**:
   - Use `scripts/ps1/dbnotebook-service.ps1 -Action Install` so dependency bootstrap uses the Windows-filtered requirements path.

---

### Windows Service Install/Start Issues

**Symptoms**: service remains `Paused`, `Failed to start`, or repeatedly restarts.

**Solutions**:

1. **Run service actions in elevated PowerShell** (Run as Administrator).

2. **Use explicit tool paths** when installing:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 `
     -Action Install `
     -NodeDir "C:\tools\node-v24.14.0-win-x64" `
     -BootstrapPythonExe "C:\tools\python-3.11.9\python.exe"
   ```

3. **Check service log first**:
   ```powershell
   Get-Content .\logs\windows-service.log -Tail 200
   ```

4. **Verify alembic executable exists in venv**:
   ```powershell
   Test-Path .\venv\Scripts\alembic.exe
   ```

5. **Recreate service cleanly**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Stop
   powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Uninstall
   powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Install -NodeDir "C:\tools\node-v24.14.0-win-x64" -BootstrapPythonExe "C:\tools\python-3.11.9\python.exe"
   powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Start
   ```

---

### Frontend `dist` Folder Missing

**Symptoms**: `frontend/dist` not found, UI not served.

**Solutions**:

1. Build manually:
   ```bash
   cd frontend
   npm install
   npm run build
   ```

2. Confirm output:
   ```bash
   ls frontend/dist
   ```

   Windows PowerShell:
   ```powershell
   Get-ChildItem .\frontend\dist
   ```

3. For service mode, verify Node path passed through `-NodeDir`.

---

### Config File Encoding Errors on Windows

**Symptoms**: `charmap codec can't decode byte ...` while loading `config/dbnotebook.yaml`.

**Solutions**:

1. Convert config files to UTF-8 (without ANSI/legacy codepages).
2. Re-save `config/dbnotebook.yaml` in UTF-8 using your editor.
3. Restart service:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Stop
   powershell -ExecutionPolicy Bypass -File .\scripts\ps1\dbnotebook-service.ps1 -Action Start
   ```

---

### Excel Ingestion Fails with Missing `openpyxl`

**Symptoms**: pandas error mentioning missing optional dependency `openpyxl`.

**Solutions**:

1. Install into the active environment:
   ```bash
   pip install openpyxl
   ```

   Windows PowerShell:
   ```powershell
   .\venv\Scripts\python.exe -m pip install openpyxl
   ```

2. Verify:
   ```bash
   python -c "import openpyxl; print(openpyxl.__version__)"
   ```

---

## LLM Provider Issues

### Ollama Connection Failed

**Symptoms**: `Connection refused to localhost:11434`

**Solutions**:

1. **Check Ollama is running**:
   ```bash
   ollama list
   ```

2. **Pull required model**:
   ```bash
   ollama pull llama3.1:latest
   ```

3. **For Docker, use correct host**:
   ```bash
   # In .env
   OLLAMA_HOST=http://host.docker.internal:11434
   ```

---

### OpenAI Rate Limits

**Symptoms**: `RateLimitError` or `429 Too Many Requests`

**Solutions**:

1. **Check API quota** at [platform.openai.com](https://platform.openai.com)

2. **Use a smaller model**:
   ```bash
   LLM_MODEL=gpt-4.1-mini
   ```

3. **Reduce batch sizes**:
   ```yaml
   # config/dbnotebook.yaml (ingestion section)
   ingestion:
     embedding:
       batch_size: 4
   ```

---

### Groq Rate Limits

**Symptoms**: `rate_limit_exceeded` errors

**Solutions**:

The Groq provider implements automatic exponential backoff (5 retries, up to 60s). If still failing:

1. **Check your Groq tier** - Free tier has strict limits

2. **Reduce concurrent requests**:
   ```bash
   # In config
   max_concurrent_summaries: 1
   ```

3. **Monitor usage** at [console.groq.com](https://console.groq.com)

---

### Anthropic Errors

**Symptoms**: `AuthenticationError` or context length errors

**Solutions**:

1. **Verify API key**:
   ```bash
   curl https://api.anthropic.com/v1/messages \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "content-type: application/json" \
     -d '{"model":"claude-sonnet-4-20250514","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
   ```

2. **For context errors, reduce chat limit**:
   ```bash
   CHAT_TOKEN_LIMIT=16000
   ```

---

## Retrieval Issues

### Chat Not Finding Documents

**Symptoms**: "I don't have information about that" despite uploaded documents

**Solutions**:

1. **Verify notebook context is set**:
   ```python
   # Check in logs for
   "Switched to notebook: <uuid>"
   ```

2. **Confirm documents are active**:
   ```sql
   SELECT name, active FROM notebook_sources
   WHERE notebook_id = '<your-notebook-id>';
   ```

3. **Check embeddings exist**:
   ```sql
   SELECT COUNT(*) FROM data_embeddings
   WHERE notebook_id = '<your-notebook-id>';
   ```

4. **Verify embedding dimensions match**:
   ```bash
   # In .env, must match your model
   PGVECTOR_EMBED_DIM=1536  # OpenAI
   PGVECTOR_EMBED_DIM=768   # nomic
   ```

---

### Poor Retrieval Quality

**Symptoms**: Retrieved chunks aren't relevant to queries

**Solutions**:

1. **Enable reranking**:
   ```yaml
   # config/dbnotebook.yaml (retrieval section)
   retrieval:
     reranker:
       enabled: true
       model: "large"
   ```

2. **Use hybrid retrieval**:
   ```bash
   RETRIEVAL_STRATEGY=hybrid
   ```

3. **Adjust similarity threshold**:
   ```yaml
   retrieval:
     similarity_top_k: 30  # Get more candidates
   reranker:
     top_k: 10             # Rerank to best 10
   ```

4. **Build RAPTOR trees** for better summaries:
   ```bash
   python scripts/rebuild_raptor.py --notebook-id <id>
   ```

---

### RAPTOR Tree Not Building

**Symptoms**: `raptor_status` stays at `pending` or `building`

**Solutions**:

1. **Check RAPTOR is enabled**:
   ```bash
   RAPTOR_ENABLED=true
   RAPTOR_AUTO_BUILD=true
   ```

2. **Check source status**:
   ```sql
   SELECT name, raptor_status FROM notebook_sources
   WHERE notebook_id = '<id>';
   ```

3. **Manually trigger rebuild**:
   ```bash
   python scripts/rebuild_raptor.py --notebook-id <id>
   ```

4. **Check logs for errors**:
   ```bash
   grep "RAPTOR" logs/dbnotebook.log | tail -50
   ```

---

## SQL Chat Issues

### Connection Test Fails

**Symptoms**: "Connection failed" when testing database

**Solutions**:

1. **Verify credentials** are correct

2. **Check network access**:
   ```bash
   # Can you reach the database?
   nc -zv hostname port
   ```

3. **For cloud databases**, ensure IP is whitelisted

4. **Check SSL requirements**:
   ```bash
   # Some databases require SSL
   # Add to connection string: ?sslmode=require
   ```

---

### "Access Denied" on Query

**Symptoms**: Queries fail with permission errors

**Solutions**:

1. **Verify SELECT permissions**:
   ```sql
   -- Check user permissions
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO your_user;
   ```

2. **Use a read-only user** (recommended):
   ```sql
   CREATE USER readonly_user WITH PASSWORD 'password';
   GRANT CONNECT ON DATABASE mydb TO readonly_user;
   GRANT USAGE ON SCHEMA public TO readonly_user;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_user;
   ```

---

### Incorrect SQL Generated

**Symptoms**: Generated SQL has wrong table/column names

**Solutions**:

1. **Be specific in your question**:
   ```
   Bad:  "Show me the orders"
   Good: "Show me orders from the orders table for last month"
   ```

2. **Generate a schema dictionary**:
   - Click "Generate Schema Dictionary" on your connection
   - This creates a RAG-enhanced context for SQL generation

3. **Check schema detection**:
   ```bash
   # View detected schema
   curl http://localhost:7860/api/sql-chat/schema/<connection_id>
   ```

---

## Frontend Issues

### Blank Page or Loading Forever

**Symptoms**: Frontend shows nothing or infinite loading

**Solutions**:

1. **Check browser console** (F12 → Console) for errors

2. **Verify API is running**:
   ```bash
   curl http://localhost:7860/api/auth/me
   ```

3. **Rebuild frontend**:
   ```bash
   cd frontend
   rm -rf node_modules
   npm install
   npm run build
   ```

4. **Check Vite proxy** (dev mode):
   ```javascript
   // vite.config.ts - proxy should point to Flask
   proxy: {
     '/api': 'http://localhost:7860'
   }
   ```

---

### Login Fails

**Symptoms**: Can't log in with admin/admin123

**Solutions**:

1. **Check user exists**:
   ```sql
   SELECT username FROM users WHERE username = 'admin';
   ```

2. **Reset admin password**:
   ```python
   # Run in Python shell
   from dbnotebook.core.auth import AuthService
   auth = AuthService(db_manager)
   auth.change_password('admin', 'newpassword')
   ```

3. **Check session secret**:
   ```bash
   # .env must have
   FLASK_SECRET_KEY=your-secret-key
   ```

---

### Charts Not Rendering

**Symptoms**: Analytics dashboard shows empty charts

**Solutions**:

1. **Check data was parsed**:
   - Go to "Data Profile" tab
   - Verify column types are detected

2. **Check browser console** for JavaScript errors

3. **Try a different file** - some Excel formats may have issues

4. **Clear browser cache** and reload

---

## Docker Issues

### Container Won't Start

**Symptoms**: `docker compose up` fails

**Solutions**:

1. **Check port conflicts**:
   ```bash
   lsof -i :7007  # Check if port is in use
   ```

2. **View container logs**:
   ```bash
   docker compose logs dbnotebook
   ```

3. **Rebuild from scratch**:
   ```bash
   docker compose down -v
   docker compose build --no-cache
   docker compose up
   ```

---

### Changes Not Reflected

**Symptoms**: Code changes don't appear in running container

**Solutions**:

1. **Check volume mounts** in docker-compose.yml:
   ```yaml
   volumes:
     - ./dbnotebook:/app/dbnotebook  # Backend
     - ./config:/app/config          # Config
   ```

2. **For frontend changes**, rebuild:
   ```bash
   cd frontend && npm run build
   # Then refresh browser
   ```

3. **For config changes**, restart container:
   ```bash
   docker compose restart dbnotebook
   ```

---

### Can't Connect to Ollama

**Symptoms**: `Connection refused` from Docker to Ollama

**Solutions**:

```bash
# In .env, use Docker's host reference
OLLAMA_HOST=http://host.docker.internal:11434

# For Linux, use host network mode or
OLLAMA_HOST=http://172.17.0.1:11434
```

---

## Performance Issues

### Slow Document Upload

**Symptoms**: Large documents take very long to process

**Solutions**:

1. **Reduce chunk size**:
   ```yaml
   # config/dbnotebook.yaml (ingestion section)
   ingestion:
     chunking:
       chunk_size: 256  # Smaller chunks
   ```

2. **Increase batch size** (if you have memory):
   ```yaml
   # config/dbnotebook.yaml (ingestion section)
   ingestion:
     embedding:
       batch_size: 16
   ```

3. **Disable RAPTOR auto-build**:
   ```bash
   RAPTOR_AUTO_BUILD=false
   ```
   Build manually later with `scripts/rebuild_raptor.py`

---

### Slow Chat Responses

**Symptoms**: Long wait times for answers

**Solutions**:

1. **Use faster LLM**:
   ```bash
   LLM_PROVIDER=groq  # Very fast inference
   ```

2. **Reduce retrieval scope**:
   ```yaml
   retrieval:
     similarity_top_k: 10  # Fewer candidates
   reranker:
     top_k: 5              # Fewer final results
   ```

3. **Use smaller reranker**:
   ```yaml
   reranker:
     model: "xsmall"
   ```

4. **Check for cold starts** - first query is always slower

---

### High Memory Usage

**Symptoms**: Out of memory errors or system slowdown

**Solutions**:

1. **Use smaller embedding model**:
   ```bash
   EMBEDDING_MODEL=text-embedding-3-small
   ```

2. **Reduce reranker model**:
   ```yaml
   reranker:
     model: "xsmall"  # ~100MB vs 1.2GB for large
   ```

3. **Limit concurrent operations**:
   ```yaml
   # config/dbnotebook.yaml (raptor section)
   raptor:
     tree_building:
       max_concurrent_summaries: 1
   ```

---

## Database Issues

### Migration Conflicts

**Symptoms**: `alembic upgrade head` fails with multiple heads

**Solutions**:

1. **Check for multiple heads**:
   ```bash
   alembic heads
   ```

2. **Merge if needed**:
   ```bash
   alembic merge -m "merge heads" head1 head2
   alembic upgrade head
   ```

---

### Embedding Dimension Mismatch

**Symptoms**: `ValueError: could not broadcast input array`

**Solutions**:

1. **Check current dimension**:
   ```sql
   SELECT vector_dims(embedding) FROM data_embeddings LIMIT 1;
   ```

2. **If switching models**, you must:
   - Update `PGVECTOR_EMBED_DIM` in .env
   - Clear existing embeddings:
     ```sql
     TRUNCATE data_embeddings;
     ```
   - Re-upload documents

---

## Getting More Help

### Enable Debug Logging

```bash
LOG_LEVEL=DEBUG
```

### Check Logs

```bash
# Flask logs
tail -f logs/dbnotebook.log

# Docker logs
docker compose logs -f dbnotebook

# Filter for errors
grep -i error logs/dbnotebook.log
```

### Report Issues

If you can't resolve an issue:

1. Check existing issues: [GitHub Issues](https://github.com/your-repo/issues)
2. Include in your report:
   - Error message (full traceback)
   - Steps to reproduce
   - Environment (OS, Python version, Docker?)
   - Relevant .env settings (redact secrets!)
