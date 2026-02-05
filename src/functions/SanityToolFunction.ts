import 'reflect-metadata';
import { ToolFunction, tool, ParameterType } from '@optimizely-opal/opal-tool-ocp-sdk';
import { createClient, SanityClient } from '@sanity/client';
import { storage, logger } from '@zaiusinc/app-sdk';

/**
 * Settings stored in OCP storage
 */
interface SanityConnectionSettings {
  project_id: string;
  dataset: string;
  api_token: string;
  api_version?: string;
}

interface ContentSettings {
  use_cdn?: string;
  default_document_types?: string;
}

interface RagSettings {
  max_search_results?: string;
  content_chunk_size?: string;
}

/**
 * Sanity Content Tool Function.
 *
 * This class contains the tool methods that will be exposed to Opal
 * for Sanity CMS content operations.
 */
export class SanityToolFunction extends ToolFunction {
  /**
   * Creates a configured Sanity client using stored settings.
   */
  private async getSanityClient(): Promise<SanityClient> {
    const connectionSettings = await storage.settings.get('sanity_connection') as unknown as SanityConnectionSettings | null;
    const contentSettings = await storage.settings.get('content_settings') as unknown as ContentSettings | null;

    if (!connectionSettings) {
      throw new Error('Sanity connection not configured. Please configure your Sanity settings in the app settings.');
    }

    const { project_id, dataset, api_token, api_version } = connectionSettings;

    if (!project_id || !dataset || !api_token) {
      throw new Error('Sanity connection incomplete. Please provide project ID, dataset, and API token.');
    }

    return createClient({
      projectId: project_id,
      dataset: dataset,
      token: api_token,
      apiVersion: api_version || '2024-01-01',
      useCdn: contentSettings?.use_cdn === 'true'
    });
  }

  /**
   * Get RAG settings from storage
   */
  private async getRagSettings(): Promise<RagSettings> {
    const settings = await storage.settings.get('rag_settings') as unknown as RagSettings | null;
    return settings || {};
  }

  /**
   * Tool: Get information about this Sanity Content Tool
   */
  @tool({
    name: 'get_tool_info',
    description: 'Returns information about this Sanity Content Tool, including version and available capabilities',
    endpoint: '/tools/info',
    parameters: []
  })
  async getToolInfo(
    parameters: Record<string, never>,
    authData?: Record<string, unknown>
  ): Promise<{
    name: string;
    version: string;
    description: string;
    capabilities: string[];
  }> {
    return {
      name: 'Sanity Content Tool',
      version: '1.0.0',
      description: 'Opal Tool for Sanity CMS content operations and RAG',
      capabilities: [
        'get_tool_info - Get tool information',
        'get_document - Fetch a single document by ID',
        'query_documents - Execute GROQ queries',
        'create_document - Create new documents',
        'update_document - Update existing documents',
        'delete_document - Delete documents',
        'publish_document - Publish draft documents',
        'unpublish_document - Unpublish documents',
        'search_content - Full-text search',
        'get_document_types - List available document types'
      ]
    };
  }

  /**
   * Tool: Get a single document by ID
   */
  @tool({
    name: 'get_document',
    description: 'Fetches a single document from Sanity CMS by its ID. Returns the full document data.',
    endpoint: '/tools/get-document',
    parameters: [
      {
        name: 'document_id',
        type: ParameterType.String,
        description: 'The unique ID of the document to fetch',
        required: true
      }
    ]
  })
  async getDocument(
    parameters: { document_id: string },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    document?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();
      const document = await client.getDocument(parameters.document_id);

      if (!document) {
        return {
          success: false,
          error: `Document with ID "${parameters.document_id}" not found`
        };
      }

      return {
        success: true,
        document
      };
    } catch (error) {
      logger.error('Error fetching document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Tool: Execute a GROQ query
   */
  @tool({
    name: 'query_documents',
    description: 'Executes a GROQ query against Sanity CMS. IMPORTANT: Use get_document_types first to discover field names for a type. Common patterns: authors/categories use "name" not "title". Examples: *[_type == "category" && name == "MarTech"]{_id, name} or *[_type == "post"]{title, slug}',
    endpoint: '/tools/query-documents',
    parameters: [
      {
        name: 'query',
        type: ParameterType.String,
        description: 'The GROQ query to execute. IMPORTANT: Use get_document_types first to learn the correct field names. Authors and categories typically use "name", posts use "title".',
        required: true
      }
    ]
  })
  async queryDocuments(
    parameters: { query: string },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    results?: unknown[];
    count?: number;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();
      const results = await client.fetch(parameters.query);

      return {
        success: true,
        results: Array.isArray(results) ? results : [results],
        count: Array.isArray(results) ? results.length : 1
      };
    } catch (error) {
      logger.error('Error executing query:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Helper: Convert plain text to Sanity Portable Text block array
   */
  private textToPortableText(text: string): Array<Record<string, unknown>> {
    return text.split('\n\n').map((paragraph, index) => ({
      _key: `block-${index}`,
      _type: 'block',
      children: [
        {
          _key: `span-${index}`,
          _type: 'span',
          marks: [],
          text: paragraph.trim()
        }
      ],
      markDefs: [],
      style: 'normal'
    }));
  }

  /**
   * Helper: Infer the Sanity field type from an actual value
   */
  private inferFieldType(value: unknown): string {
    if (value === null || value === undefined) {
      return 'unknown';
    }

    if (typeof value === 'string') {
      // Check if it looks like a datetime
      if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(value)) {
        return 'datetime';
      }
      return 'string';
    }

    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'number';
    }

    if (typeof value === 'boolean') {
      return 'boolean';
    }

    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        const firstItem = value[0] as Record<string, unknown>;
        if (firstItem._type === 'block') {
          return 'portableText';
        }
        if (firstItem._type === 'reference') {
          return 'array of references';
        }
        return `array of ${firstItem._type || 'objects'}`;
      }
      return 'array';
    }

    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (obj._type === 'slug') {
        return 'slug';
      }
      if (obj._type === 'image') {
        return 'image';
      }
      if (obj._type === 'reference') {
        return 'reference';
      }
      if (obj.asset && typeof obj.asset === 'object') {
        return 'image';
      }
      return obj._type ? String(obj._type) : 'object';
    }

    return 'unknown';
  }

  /**
   * Tool: Create a new document
   */
  @tool({
    name: 'create_document',
    description: 'Creates a new document in Sanity CMS as a draft. IMPORTANT: Call get_document_types FIRST to discover field names and types. Use "name" for authors/categories, "title" for posts/pages. For fields that get_document_types reports as "portableText", use the "body" or "bio" parameters (plain text auto-converts). For "string" fields, use the matching parameter directly.',
    endpoint: '/tools/create-document',
    parameters: [
      {
        name: 'document_type',
        type: ParameterType.String,
        description: 'The Sanity document type (e.g., "post", "page", "author", "category")',
        required: true
      },
      {
        name: 'title',
        type: ParameterType.String,
        description: 'Title field - ONLY for "post" and "page" types. Do NOT use for authors or categories (use "name" instead).',
        required: false
      },
      {
        name: 'name',
        type: ParameterType.String,
        description: 'Name field - REQUIRED for "author", "category", and "tag" types. Do NOT use for posts or pages (use "title" instead).',
        required: false
      },
      {
        name: 'slug',
        type: ParameterType.String,
        description: 'URL-friendly slug (e.g., "my-blog-post"). Auto-formatted as a Sanity slug object.',
        required: false
      },
      {
        name: 'body',
        type: ParameterType.String,
        description: 'Body/content as plain text. ONLY use if get_document_types shows the "body" field type is "portableText". Plain text is auto-converted to Sanity block format. Separate paragraphs with blank lines.',
        required: false
      },
      {
        name: 'description',
        type: ParameterType.String,
        description: 'Short description or excerpt text',
        required: false
      },
      {
        name: 'bio',
        type: ParameterType.String,
        description: 'Bio as plain text. ONLY use if get_document_types shows the "bio" field type is "portableText". Plain text is auto-converted to Sanity block format.',
        required: false
      },
      {
        name: 'extra_fields',
        type: ParameterType.String,
        description: 'Additional fields as a simple JSON string for any fields not covered above. Example: {"color": "blue", "order": 3}',
        required: false
      },
      {
        name: 'publish',
        type: ParameterType.Boolean,
        description: 'Whether to publish immediately. Default is false (creates as draft).',
        required: false
      }
    ]
  })
  async createDocument(
    parameters: {
      document_type: string;
      title?: string;
      slug?: string;
      body?: string;
      description?: string;
      name?: string;
      bio?: string;
      extra_fields?: string;
      publish?: boolean;
    },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    document_id?: string;
    document?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();

      // Build document from flat parameters
      const document: Record<string, unknown> = {
        _type: parameters.document_type
      };

      // Create as draft by default
      if (!parameters.publish) {
        document._id = 'drafts.';
      }

      // Map flat params to Sanity fields
      if (parameters.title) {
        document.title = parameters.title;
      }

      if (parameters.name) {
        document.name = parameters.name;
      }

      if (parameters.slug) {
        document.slug = { _type: 'slug', current: parameters.slug };
      }

      if (parameters.description) {
        document.description = parameters.description;
      }

      if (parameters.body) {
        document.body = this.textToPortableText(parameters.body);
      }

      if (parameters.bio) {
        document.bio = this.textToPortableText(parameters.bio);
      }

      // Parse any extra fields
      if (parameters.extra_fields) {
        try {
          const extra = typeof parameters.extra_fields === 'string'
            ? JSON.parse(parameters.extra_fields)
            : parameters.extra_fields;
          Object.assign(document, extra);
        } catch (e) {
          logger.warn('Could not parse extra_fields, skipping:', e);
        }
      }

      logger.info('Creating document:', JSON.stringify(document));

      const result = await client.create(document as { _type: string; [key: string]: unknown });

      return {
        success: true,
        document_id: result._id,
        document: result
      };
    } catch (error) {
      logger.error('Error creating document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Tool: Update an existing document
   */
  @tool({
    name: 'update_document',
    description: 'Updates specific fields on an existing Sanity document. IMPORTANT: Call get_document_types FIRST to discover correct field names and types. Use "name" for authors/categories, "title" for posts/pages. For "portableText" fields, use body/bio params. For "string" fields, use the matching parameter.',
    endpoint: '/tools/update-document',
    parameters: [
      {
        name: 'document_id',
        type: ParameterType.String,
        description: 'The ID of the document to update (e.g., "drafts.abc123" or "abc123")',
        required: true
      },
      {
        name: 'title',
        type: ParameterType.String,
        description: 'New title - ONLY for "post" and "page" types. Do NOT use for authors or categories.',
        required: false
      },
      {
        name: 'name',
        type: ParameterType.String,
        description: 'New name - for "author", "category", and "tag" types. Do NOT use for posts or pages.',
        required: false
      },
      {
        name: 'slug',
        type: ParameterType.String,
        description: 'New URL-friendly slug',
        required: false
      },
      {
        name: 'body',
        type: ParameterType.String,
        description: 'New body/content as plain text. ONLY use if get_document_types shows "body" is "portableText". Auto-converted to Sanity block format.',
        required: false
      },
      {
        name: 'description',
        type: ParameterType.String,
        description: 'New description or excerpt',
        required: false
      },
      {
        name: 'bio',
        type: ParameterType.String,
        description: 'New bio as plain text. ONLY use if get_document_types shows "bio" is "portableText". Auto-converted to Sanity block format.',
        required: false
      },
      {
        name: 'extra_fields',
        type: ParameterType.String,
        description: 'Additional fields as a simple JSON string. Example: {"color": "blue", "order": 3}',
        required: false
      }
    ]
  })
  async updateDocument(
    parameters: {
      document_id: string;
      title?: string;
      slug?: string;
      body?: string;
      description?: string;
      name?: string;
      bio?: string;
      extra_fields?: string;
    },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    document?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();

      // Build updates from flat parameters
      const updates: Record<string, unknown> = {};

      if (parameters.title) {
        updates.title = parameters.title;
      }

      if (parameters.name) {
        updates.name = parameters.name;
      }

      if (parameters.slug) {
        updates.slug = { _type: 'slug', current: parameters.slug };
      }

      if (parameters.description) {
        updates.description = parameters.description;
      }

      if (parameters.body) {
        updates.body = this.textToPortableText(parameters.body);
      }

      if (parameters.bio) {
        updates.bio = this.textToPortableText(parameters.bio);
      }

      // Parse any extra fields
      if (parameters.extra_fields) {
        try {
          const extra = typeof parameters.extra_fields === 'string'
            ? JSON.parse(parameters.extra_fields)
            : parameters.extra_fields;
          Object.assign(updates, extra);
        } catch (e) {
          logger.warn('Could not parse extra_fields, skipping:', e);
        }
      }

      if (Object.keys(updates).length === 0) {
        return {
          success: false,
          error: 'No fields to update. Provide at least one field (title, name, slug, body, description, bio, or extra_fields).'
        };
      }

      const result = await client
        .patch(parameters.document_id)
        .set(updates)
        .commit();

      return {
        success: true,
        document: result
      };
    } catch (error) {
      logger.error('Error updating document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Tool: Delete a document
   */
  @tool({
    name: 'delete_document',
    description: 'Deletes a document from Sanity CMS. This action is permanent and cannot be undone.',
    endpoint: '/tools/delete-document',
    parameters: [
      {
        name: 'document_id',
        type: ParameterType.String,
        description: 'The ID of the document to delete',
        required: true
      }
    ]
  })
  async deleteDocument(
    parameters: { document_id: string },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    deleted_id?: string;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();

      await client.delete(parameters.document_id);

      return {
        success: true,
        deleted_id: parameters.document_id
      };
    } catch (error) {
      logger.error('Error deleting document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Tool: Publish a draft document
   */
  @tool({
    name: 'publish_document',
    description: 'Publishes a draft document in Sanity CMS, making it publicly available.',
    endpoint: '/tools/publish-document',
    parameters: [
      {
        name: 'document_id',
        type: ParameterType.String,
        description: 'The ID of the document to publish. Can be either the draft ID (drafts.xxx) or the published ID.',
        required: true
      }
    ]
  })
  async publishDocument(
    parameters: { document_id: string },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    published_id?: string;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();

      // Ensure we're working with the draft ID
      const draftId = parameters.document_id.startsWith('drafts.')
        ? parameters.document_id
        : `drafts.${parameters.document_id}`;

      const publishedId = draftId.replace('drafts.', '');

      // Get the draft document
      const draft = await client.getDocument(draftId);

      if (!draft) {
        return {
          success: false,
          error: `Draft document "${draftId}" not found`
        };
      }

      // Create or replace the published version
      const { _id, ...documentData } = draft;
      await client.createOrReplace({
        ...documentData,
        _id: publishedId
      });

      // Delete the draft
      await client.delete(draftId);

      return {
        success: true,
        published_id: publishedId
      };
    } catch (error) {
      logger.error('Error publishing document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Tool: Unpublish a document
   */
  @tool({
    name: 'unpublish_document',
    description: 'Unpublishes a document in Sanity CMS, converting it back to a draft.',
    endpoint: '/tools/unpublish-document',
    parameters: [
      {
        name: 'document_id',
        type: ParameterType.String,
        description: 'The ID of the published document to unpublish',
        required: true
      }
    ]
  })
  async unpublishDocument(
    parameters: { document_id: string },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    draft_id?: string;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();

      // Ensure we're working with the published ID (not draft)
      const publishedId = parameters.document_id.replace('drafts.', '');
      const draftId = `drafts.${publishedId}`;

      // Get the published document
      const published = await client.getDocument(publishedId);

      if (!published) {
        return {
          success: false,
          error: `Published document "${publishedId}" not found`
        };
      }

      // Create the draft version
      const { _id, ...documentData } = published;
      await client.createOrReplace({
        ...documentData,
        _id: draftId
      });

      // Delete the published version
      await client.delete(publishedId);

      return {
        success: true,
        draft_id: draftId
      };
    } catch (error) {
      logger.error('Error unpublishing document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Tool: Search content (for RAG)
   */
  @tool({
    name: 'search_content',
    description: 'Searches content in Sanity CMS using full-text search. Useful for RAG (Retrieval-Augmented Generation) to find relevant content.',
    endpoint: '/tools/search-content',
    parameters: [
      {
        name: 'search_query',
        type: ParameterType.String,
        description: 'The search query text',
        required: true
      },
      {
        name: 'document_types',
        type: ParameterType.List,
        description: 'Optional array of document types to search within (e.g., ["post", "page"]). If not specified, searches all types.',
        required: false
      },
      {
        name: 'limit',
        type: ParameterType.Number,
        description: 'Maximum number of results to return. Defaults to the configured max_search_results setting.',
        required: false
      }
    ]
  })
  async searchContent(
    parameters: {
      search_query: string;
      document_types?: string[];
      limit?: number;
    },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    results?: Array<{
      _id: string;
      _type: string;
      _score?: number;
      [key: string]: unknown;
    }>;
    count?: number;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();
      const ragSettings = await this.getRagSettings();
      const contentSettings = await storage.settings.get('content_settings') as unknown as ContentSettings | null;

      const maxResults = parameters.limit || parseInt(ragSettings.max_search_results || '25', 10);

      // Build document type filter
      let typeFilter = '';
      const types = parameters.document_types ||
        (contentSettings?.default_document_types
          ? contentSettings.default_document_types.split(',').map(t => t.trim())
          : null);

      if (types && types.length > 0) {
        typeFilter = `_type in [${types.map(t => `"${t}"`).join(', ')}] && `;
      }

      // Build the search query using Sanity's text search
      // Include both "title" and "name" since different types use different fields
      const groqQuery = `*[${typeFilter}[title, name, body, description, content, text] match $searchTerm] | score(
        boost([title, name] match $searchTerm, 3),
        boost([description] match $searchTerm, 2),
        [body, content, text] match $searchTerm
      ) | order(_score desc) [0...${maxResults}] {
        _id,
        _type,
        _score,
        title,
        name,
        slug,
        description,
        "excerpt": coalesce(
          description,
          pt::text(body[0..2]),
          pt::text(content[0..2])
        )
      }`;

      const results = await client.fetch(groqQuery, {
        searchTerm: `*${parameters.search_query}*`
      });

      return {
        success: true,
        results,
        count: results.length
      };
    } catch (error) {
      logger.error('Error searching content:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Tool: Get available document types
   */
  @tool({
    name: 'get_document_types',
    description: 'Returns document types with their field names AND field types (e.g., string, portableText, slug, reference, image, datetime). IMPORTANT: Always call this before create_document or query_documents to learn the correct field names and types. Field type "portableText" means the field requires Sanity block content (use body/bio params). Field type "string" means plain text. Field type "slug" means a URL slug. Field type "reference" means a link to another document.',
    endpoint: '/tools/get-document-types',
    parameters: [
      {
        name: 'document_type',
        type: ParameterType.String,
        description: 'Optional: get detailed fields for a specific type (e.g., "post", "author", "category"). If omitted, returns a summary of all types with fields.',
        required: false
      }
    ]
  })
  async getDocumentTypes(
    parameters: { document_type?: string },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    types?: Array<{
      type: string;
      count: number;
      fields: Array<{ name: string; type: string }>;
    }>;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();

      if (parameters.document_type) {
        // Get detailed field info for a specific type by sampling documents
        const docs = await client.fetch(
          `*[_type == $type][0...5]`,
          { type: parameters.document_type }
        ) as Array<Record<string, unknown>>;

        // Collect field names and infer types from values across samples
        const fieldTypes: Record<string, string> = {};
        for (const doc of docs) {
          for (const [key, value] of Object.entries(doc)) {
            // Only set type if we haven't seen it yet or current is 'unknown'
            if (!fieldTypes[key] || fieldTypes[key] === 'unknown') {
              fieldTypes[key] = this.inferFieldType(value);
            }
          }
        }

        const fields = Object.entries(fieldTypes)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, type]) => ({ name, type }));

        const totalCount = await client.fetch(
          `count(*[_type == $type])`,
          { type: parameters.document_type }
        );

        return {
          success: true,
          types: [{
            type: parameters.document_type,
            count: totalCount as number,
            fields
          }]
        };
      }

      // Get all types with sample fields from one document each
      const query = `*[!(_type match "system.*") && !(_type match "sanity.*")] { _type }`;
      const allDocs = await client.fetch(query) as Array<Record<string, unknown>>;

      // Count types
      const typeCounts: Record<string, number> = {};
      for (const doc of allDocs) {
        const t = doc._type as string;
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      }

      // Fetch one sample per type and infer field types
      const types: Array<{ type: string; count: number; fields: Array<{ name: string; type: string }> }> = [];

      for (const type of Object.keys(typeCounts).sort()) {
        const sample = await client.fetch(
          `*[_type == $type][0]`,
          { type }
        ) as Record<string, unknown> | null;

        const fields: Array<{ name: string; type: string }> = [];
        if (sample) {
          for (const [key, value] of Object.entries(sample)) {
            fields.push({ name: key, type: this.inferFieldType(value) });
          }
          fields.sort((a, b) => a.name.localeCompare(b.name));
        }

        types.push({
          type,
          count: typeCounts[type],
          fields
        });
      }

      return {
        success: true,
        types
      };
    } catch (error) {
      logger.error('Error fetching document types:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}
