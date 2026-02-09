# CLAUDE.md - Opal Sanity Tool

## Project Overview
This is an Opal Tool for Optimizely Connect Platform (OCP) that integrates with Sanity CMS. The tool provides content operations (CRUD, publish) and RAG (Retrieval-Augmented Generation) capabilities using Sanity's APIs.

## Template Reference
Based on: https://github.com/egandalf/opal_ocp_template

## Project Structure
```
opal-sanity-tool/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── functions/
│   │   └── SanityToolFunction.ts # Tool implementations
│   └── lifecycle/
│       └── Lifecycle.ts         # OCP lifecycle hooks
├── forms/
│   └── settings.yml             # Sanity connection settings form
├── assets/
│   ├── icon.svg
│   ├── logo.svg
│   └── directory/
│       └── overview.md          # Required: must be at assets/directory/overview.md
├── app.yml                      # OCP app manifest
├── package.json
├── tsconfig.json
├── TODO.md
└── CLAUDE.md
```

## Key Technologies
- **Platform**: Optimizely Connect Platform (OCP)
- **Language**: TypeScript
- **Runtime**: Node.js v22+
- **CMS**: Sanity CMS
- **API**: Sanity Content Lake API, GROQ queries

## OCP Tool Development

### Tool Decorator Pattern
Tools use the `@tool` decorator:
```typescript
@tool({
  name: 'toolName',
  description: 'What the tool does',
  endpoint: '/path/to/endpoint',
  parameters: [
    { name: 'param1', type: 'String', description: 'Param description', required: true }
  ]
})
async toolName(params: { param1: string }, auth?: AuthData): Promise<ToolResult> {
  // Implementation
}
```

### Parameter Types (ParameterType enum)
- `String` - Text values
- `Number` - Numeric values
- `Integer` - Integer values
- `Boolean` - True/false
- `Dictionary` - JSON objects (NOT "Object")
- `List` - Arrays of values (NOT "Array")

### Lifecycle Hooks
- `onInstall()` - When app is installed
- `onUpgrade()` - When app is upgraded
- `onFinalizeUpgrade()` - After upgrade completes
- `onUninstall()` - When app is uninstalled
- `onSettingsForm()` - When settings form is accessed

## Sanity Integration

### Authentication
Requires Sanity API token with appropriate permissions:
- Read: For queries and document retrieval
- Write: For create, update, delete operations
- Assets: For file/image uploads

### Key Sanity APIs
- **Query API**: GROQ queries for content retrieval
- **Mutations API**: Create, update, delete, publish operations
- **Assets API**: File and image management
- **Search**: Full-text search capabilities

### GROQ Basics
```groq
// All documents of type
*[_type == "post"]

// With filters
*[_type == "post" && publishedAt > "2024-01-01"]

// With projections
*[_type == "post"]{title, slug, author->name}

// Text search
*[_type == "post" && [title, body] match "search term"]
```

## Development Commands

```bash
# Install dependencies
npm install

# Build
npm run build

# Lint
npm run lint

# Test
npm run test

# OCP App Commands
ocp app register                          # Register app with OCP
ocp app validate                          # Validate app locally
ocp app prepare                           # Validate, package, upload and build
ocp app package                           # Package for manual upload

# OCP Directory Commands (publish, install, manage)
ocp directory publish jgs_sanity_cms@1.0.0-dev.1                          # Publish a version
ocp directory install jgs_sanity_cms@1.0.0-dev.1 <account_id>            # Install to an account
ocp directory status                                                      # Check app version status
ocp directory info                                                        # Get app info
ocp directory list                                                        # List registered app versions
ocp directory list-installs                                               # List installations
ocp directory list-functions                                              # List exposed functions
ocp directory uninstall                                                   # Uninstall from an account
ocp directory unpublish                                                   # Unpublish a version
ocp directory upgrade                                                     # Upgrade an install to a new version
```

## Configuration Files

### app.yml (Configured)
- **app_id**: `jgs_sanity_cms` (must match: `^[a-z][a-z_0-9]{2,31}$`)
- **display_name**: `Sanity Content Tool`
- **vendor**: `optimizely`
- **runtime**: `node22`
- **entry_point**: `SanityToolFunction`

### forms/settings.yml Sections
1. **sanity_connection** - Project ID, Dataset, API Token, API Version
2. **content_settings** - CDN usage, Default document types
3. **rag_settings** - Max search results, Content chunk size

### forms/settings.yml Notes
- Use `help:` not `helpText:` for field descriptions
- Use `text:` not `label:` in select options
- Use `type: secret` for sensitive fields (NOT `password`)
- Valid types: `text`, `secret`, `select`
- Required fields need proper validation

## RAG Implementation Notes

### Approach
1. Use Sanity's search API for initial retrieval
2. Chunk content appropriately for context windows
3. Return formatted content for LLM augmentation

### Search Strategies
- Full-text search via GROQ `match` operator
- Structured queries with filters
- Consider implementing vector embeddings for semantic search

## Build & Validation

### Common Issues
- Ensure `grpc-boom` resolution is set to `3.0.11` in package.json
- Include both `lint` and `test` scripts
- Validate app.yml against OCP schema
- `app_id` must be lowercase alpha-numeric and underscore only (`^[a-z][a-z_0-9]{2,31}$`)
- `assets/directory/overview.md` is required (NOT `assets/overview.md`)
- Form field types must be valid: `text`, `secret`, `select` (NOT `password`)
- Must have `yarn.lock` for `ocp app prepare` (run `yarn install --ignore-engines`)
- Requires Node.js v22+ for OCP CLI commands

### Testing
- Mock Sanity API responses for unit tests
- Use Sanity's mock client for integration tests
- Test all error handling paths

## Available Tools (Implemented)

| Tool | Description |
|------|-------------|
| `get_tool_info` | Returns tool version and capabilities |
| `get_document` | Fetch a single document by ID |
| `query_documents` | Execute GROQ queries |
| `create_document` | Create new documents |
| `update_document` | Update existing documents |
| `delete_document` | Delete documents |
| `publish_document` | Publish draft documents |
| `unpublish_document` | Unpublish documents to draft |
| `search_content` | Full-text search with text preview and custom field support |
| `get_document_types` | List available document types |
| `upload_asset` | Upload images/files from base64 data or public URL |
| `get_document_text` | Extract chunked plain text from a specific document |
| `retrieve_context` | RAG: search, extract, and chunk content for LLM context |
| `get_content_catalog` | Discover available content types, fields, and samples |

## Resources
- [Sanity Documentation](https://www.sanity.io/docs)
- [GROQ Reference](https://www.sanity.io/docs/groq)
- [Sanity Client](https://www.sanity.io/docs/js-client)
- [OCP Documentation](https://docs.developers.optimizely.com/platform)
