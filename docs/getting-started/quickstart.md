# Quick Start

Get up and running with DBNotebook in 5 minutes.

---

## Step 1: Start the Application

If you haven't installed yet, see [Installation](installation.md).

```bash
cd dbnotebook
bash ./scripts/sh/dev.sh local
```

Windows users can run the foreground process with:

```powershell
.\venv\Scripts\python.exe -m dbnotebook --host 0.0.0.0 --port 7860
```

For Windows service setup or production entry points, see [Cross-Platform Deployment](../deployment/CROSS_PLATFORM_DEPLOYMENT.md).

Open http://localhost:7860 and login with `admin` / `admin123`.

---

## Step 2: Create Your First Notebook

1. Click **"New Notebook"** in the sidebar
2. Enter a name like "Project Research"
3. Click **Create**

Notebooks are containers for related documents. Create separate notebooks for different projects or topics.

---

## Step 3: Upload Documents

Drag and drop files into the upload area, or click to browse.

**Supported formats:**

| Type | Extensions |
|------|------------|
| Documents | PDF, DOCX, PPTX, TXT, MD |
| Data | XLSX, XLS, CSV |
| Images | PNG, JPG, WebP |
| E-books | EPUB |

!!! tip "Processing Time"
    Large PDFs may take 30-60 seconds to process. You'll see a progress indicator.

---

## Step 4: Chat with Your Documents

Once documents are uploaded, start asking questions:

**Example queries:**

- "What are the main topics covered in these documents?"
- "Summarize the key findings"
- "What does it say about [specific topic]?"
- "Compare the approaches mentioned in document A vs document B"

The AI will:

1. Search your documents for relevant passages
2. Generate an answer based on the content
3. Show source citations so you can verify

---

## Step 5: Explore Advanced Features

### Web Search Integration

Click the **Web Search** button to:

1. Search the web for additional information
2. Preview results
3. Add relevant pages to your notebook

### AI Transformations

Each document gets automatic AI-generated:

- **Dense Summary**: Comprehensive summary
- **Key Insights**: Bullet points of important takeaways
- **Reflection Questions**: Questions to deepen understanding

Click on a document to view these transformations.

### Content Studio

Generate visual content from your notebook:

1. Go to **Studio** tab
2. Select content type (Infographic, Mind Map)
3. Choose topic focus
4. Generate and download

---

## Using the API

For programmatic access, use the REST API:

```bash
# Get your API key from the UI or use default
API_KEY="dbn_00000000000000000000000000000001"

# List notebooks
curl http://localhost:7860/api/query/notebooks \
  -H "X-API-Key: $API_KEY"

# Query a notebook
curl -X POST http://localhost:7860/api/query \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "notebook_id": "YOUR_NOTEBOOK_ID",
    "query": "What are the key points?"
  }'
```

See [API Guide](../api/API_GUIDE.md) for full documentation.

---

## Next Steps

- [RAG Chat Guide](../features/rag-chat.md) - Deep dive into chat features
- [SQL Chat Guide](../features/sql-chat.md) - Query databases with natural language
- [Configuration](../configuration.md) - Customize your setup
- [Architecture](../ARCHITECTURE.md) - Understand how it works
