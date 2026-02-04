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
│   └── overview.md
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

### Parameter Types
- `String` - Text values
- `Number` - Numeric values
- `Boolean` - True/false
- `Object` - JSON objects
- `Array` - Arrays of values

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

# OCP Commands
ocp app register      # Register app with OCP
ocp app prepare       # Prepare for publishing
ocp app publish       # Publish to marketplace
ocp app install       # Install for testing
```

## Configuration Files

### app.yml Placeholders
Replace these in `app.yml`:
- `{{APP_ID}}` - Unique app identifier (e.g., `sanity-content-tool`)
- `{{APP_DISPLAY_NAME}}` - Display name (e.g., `Sanity Content Tool`)
- `{{APP_SUMMARY}}` - Brief description
- `{{GITHUB_USERNAME}}` - Your GitHub username
- `{{REPO_NAME}}` - Repository name
- `{{CONTACT_EMAIL}}` - Support email
- `{{TOOL_DESCRIPTION}}` - Tool description for marketplace

### forms/settings.yml Notes
- Use `help:` not `helpText:` for field descriptions
- Use `text:` not `label:` in select options
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

### Testing
- Mock Sanity API responses for unit tests
- Use Sanity's mock client for integration tests
- Test all error handling paths

## Resources
- [Sanity Documentation](https://www.sanity.io/docs)
- [GROQ Reference](https://www.sanity.io/docs/groq)
- [Sanity Client](https://www.sanity.io/docs/js-client)
- [OCP Documentation](https://docs.developers.optimizely.com/platform)
