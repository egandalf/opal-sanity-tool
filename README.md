# Sanity Content Tool for Opal

An Opal Tool for Optimizely Connect Platform (OCP) that integrates with Sanity CMS, providing content operations and RAG (Retrieval-Augmented Generation) capabilities.

## Features

- **Full CRUD Operations** - Create, read, update, and delete Sanity documents
- **Publishing Workflow** - Publish and unpublish documents
- **GROQ Queries** - Execute powerful GROQ queries against your Sanity dataset
- **Full-Text Search** - Search content with relevance scoring for RAG applications
- **Document Discovery** - List available document types in your dataset

## Installation

1. Install the app from the OCP marketplace
2. Configure your Sanity connection settings:
   - **Project ID** - Your Sanity project ID
   - **Dataset** - The dataset to connect to (e.g., "production")
   - **API Token** - A Sanity API token with read/write permissions

## Configuration

### Sanity Connection
| Setting | Description | Required |
|---------|-------------|----------|
| Project ID | Your Sanity project ID (found in project settings) | Yes |
| Dataset | Dataset name (e.g., "production", "staging") | Yes |
| API Token | Token with read/write permissions from manage.sanity.io | Yes |
| API Version | API version in YYYY-MM-DD format (default: "2024-01-01") | No |

### Content Settings
| Setting | Description |
|---------|-------------|
| Use CDN | Enable Sanity CDN for faster reads (may have slight delay for fresh content) |
| Default Document Types | Comma-separated list of types to search by default |

### RAG Settings
| Setting | Description |
|---------|-------------|
| Max Search Results | Maximum documents returned from search (10, 25, 50, or 100) |
| Content Chunk Size | Size of content chunks for RAG context (500-4000 characters) |

---

## Tool Reference

### get_tool_info

Returns information about the Sanity Content Tool including version and capabilities.

**Parameters:** None

**Example Response:**
```json
{
  "name": "Sanity Content Tool",
  "version": "1.0.0",
  "description": "Opal Tool for Sanity CMS content operations and RAG",
  "capabilities": [
    "get_tool_info",
    "get_document",
    "query_documents",
    "create_document",
    "update_document",
    "delete_document",
    "publish_document",
    "unpublish_document",
    "search_content",
    "get_document_types"
  ]
}
```

---

### get_document

Fetches a single document from Sanity by its ID.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| document_id | String | Yes | The unique ID of the document to fetch |

**Example:**
```
Get the document with ID "post-123"
```

**Response:**
```json
{
  "success": true,
  "document": {
    "_id": "post-123",
    "_type": "post",
    "title": "My Blog Post",
    "slug": { "current": "my-blog-post" },
    "body": [...]
  }
}
```

---

### query_documents

Executes a GROQ query against your Sanity dataset.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | String | Yes | The GROQ query to execute |
| params | Object | No | Parameters to pass to the query |

**Example Queries:**

Get all posts:
```groq
*[_type == "post"]
```

Get posts with specific fields:
```groq
*[_type == "post"]{title, slug, publishedAt}
```

Get posts by author (with parameter):
```groq
*[_type == "post" && author._ref == $authorId]{title, slug}
```
With params: `{"authorId": "author-123"}`

Filter by date:
```groq
*[_type == "post" && publishedAt > "2024-01-01"]{title, publishedAt}
```

Join references:
```groq
*[_type == "post"]{title, "authorName": author->name}
```

**Response:**
```json
{
  "success": true,
  "results": [...],
  "count": 10
}
```

---

### create_document

Creates a new document in Sanity.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| document_type | String | Yes | The type of document (e.g., "post", "page") |
| document_data | Object | Yes | The document fields as JSON |
| publish | Boolean | No | Publish immediately (default: false, creates as draft) |

**Example:**
```json
{
  "document_type": "post",
  "document_data": {
    "title": "New Blog Post",
    "slug": { "current": "new-blog-post" },
    "author": { "_type": "reference", "_ref": "author-123" },
    "publishedAt": "2024-01-15T10:00:00Z"
  },
  "publish": false
}
```

**Response:**
```json
{
  "success": true,
  "document_id": "drafts.abc123",
  "document": {...}
}
```

---

### update_document

Updates an existing document with new field values.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| document_id | String | Yes | The ID of the document to update |
| updates | Object | Yes | Fields to update as JSON |

**Example:**
```json
{
  "document_id": "post-123",
  "updates": {
    "title": "Updated Title",
    "excerpt": "New excerpt text"
  }
}
```

**Response:**
```json
{
  "success": true,
  "document": {...}
}
```

---

### delete_document

Permanently deletes a document from Sanity.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| document_id | String | Yes | The ID of the document to delete |

**Example:**
```
Delete document "post-123"
```

**Response:**
```json
{
  "success": true,
  "deleted_id": "post-123"
}
```

> **Warning:** This action is permanent and cannot be undone.

---

### publish_document

Publishes a draft document, making it publicly available.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| document_id | String | Yes | Document ID (accepts both draft and published ID formats) |

**Example:**
```
Publish document "drafts.post-123" or "post-123"
```

**Response:**
```json
{
  "success": true,
  "published_id": "post-123"
}
```

---

### unpublish_document

Converts a published document back to draft state.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| document_id | String | Yes | The ID of the published document |

**Example:**
```
Unpublish document "post-123"
```

**Response:**
```json
{
  "success": true,
  "draft_id": "drafts.post-123"
}
```

---

### search_content

Performs full-text search across Sanity content. Designed for RAG (Retrieval-Augmented Generation) use cases.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| search_query | String | Yes | The search query text |
| document_types | Array | No | Document types to search (e.g., ["post", "page"]) |
| limit | Number | No | Max results (defaults to configured setting) |

**Example:**
```json
{
  "search_query": "machine learning",
  "document_types": ["post", "article"],
  "limit": 10
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "_id": "post-123",
      "_type": "post",
      "_score": 2.5,
      "title": "Introduction to Machine Learning",
      "slug": { "current": "intro-machine-learning" },
      "description": "A beginner's guide...",
      "excerpt": "Machine learning is..."
    }
  ],
  "count": 1
}
```

**Search Behavior:**
- Searches across `title`, `body`, `description`, `content`, and `text` fields
- Results are ranked by relevance score
- Title matches are boosted 3x, description matches 2x
- Returns excerpts for context

---

### get_document_types

Lists all document types available in your Sanity dataset with document counts.

**Parameters:** None

**Response:**
```json
{
  "success": true,
  "types": [
    { "type": "post", "count": 42 },
    { "type": "page", "count": 12 },
    { "type": "author", "count": 5 },
    { "type": "category", "count": 8 }
  ]
}
```

---

## GROQ Query Reference

GROQ (Graph-Relational Object Queries) is Sanity's query language. Here are common patterns:

### Basic Queries
```groq
// All documents of a type
*[_type == "post"]

// With field projection
*[_type == "post"]{title, slug, publishedAt}

// Single document by ID
*[_id == "post-123"][0]
```

### Filtering
```groq
// By field value
*[_type == "post" && status == "published"]

// Date comparison
*[_type == "post" && publishedAt > "2024-01-01"]

// Text matching
*[_type == "post" && title match "guide*"]

// Array contains
*[_type == "post" && "featured" in tags]
```

### References & Joins
```groq
// Expand reference
*[_type == "post"]{title, author->}

// Specific fields from reference
*[_type == "post"]{title, "authorName": author->name}

// Filter by reference
*[_type == "post" && author._ref == $authorId]
```

### Ordering & Pagination
```groq
// Order by field
*[_type == "post"] | order(publishedAt desc)

// Pagination
*[_type == "post"] | order(_createdAt desc) [0...10]

// Skip and limit
*[_type == "post"][10...20]
```

### Aggregations
```groq
// Count
count(*[_type == "post"])

// Distinct values
*[_type == "post"].category->title
```

For complete GROQ documentation, see [Sanity GROQ Reference](https://www.sanity.io/docs/groq).

---

## Error Handling

All tools return a consistent error format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

Common errors:
- **Connection not configured** - Sanity settings not set up
- **Document not found** - Invalid document ID
- **Query syntax error** - Invalid GROQ query
- **Permission denied** - API token lacks required permissions

---

## Resources

- [Sanity Documentation](https://www.sanity.io/docs)
- [GROQ Reference](https://www.sanity.io/docs/groq)
- [Sanity API Tokens](https://www.sanity.io/docs/http-auth)
- [OCP Documentation](https://docs.developers.optimizely.com/platform)

## Support

For issues or feature requests, visit: https://github.com/egandalf/opal-sanity-tool

---

## License

MIT
