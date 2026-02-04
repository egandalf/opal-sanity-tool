# Sanity Content Tool

The Sanity Content Tool integrates Optimizely's Opal AI assistant with Sanity CMS, enabling powerful content operations and RAG (Retrieval-Augmented Generation) capabilities.

## Features

### Content Operations
- **Create** - Create new documents in your Sanity dataset
- **Read** - Fetch documents by ID or execute GROQ queries
- **Update** - Update existing documents with new data
- **Delete** - Remove documents from your dataset
- **Publish** - Publish draft documents to make them live
- **Unpublish** - Revert published documents to draft state

### RAG Capabilities
- **Search** - Full-text search across your content
- **Context Retrieval** - Get relevant content for AI-powered responses
- **Document Type Discovery** - Explore available content types

## Setup

1. **Sanity Project ID** - Found in your Sanity project settings
2. **Dataset** - The dataset to connect to (e.g., "production")
3. **API Token** - Generate at manage.sanity.io with read/write permissions

## Usage Examples

### Query Documents
```
Find all blog posts published this month
```

### Create Content
```
Create a new blog post about AI in content management
```

### Search for RAG
```
Find content related to customer onboarding for context
```

## Support

For issues or questions, visit: https://github.com/egandalf/opal-sanity-tool
