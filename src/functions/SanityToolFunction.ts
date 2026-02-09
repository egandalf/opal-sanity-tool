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
      version: '1.0.0-dev.10',
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
        'search_content - Full-text search with text preview and custom field support',
        'get_document_types - List available document types',
        'upload_asset - Upload images/files from URL',
        'get_document_text - Extract chunked plain text from a document',
        'retrieve_context - RAG: search, extract, and chunk content for LLM context',
        'get_content_catalog - Discover available content types, fields, and samples'
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
   * Helper: Look up the actual field type for a given document type and field name
   * by sampling existing documents. Returns the inferred type string.
   */
  private async getFieldTypeFromSchema(
    client: SanityClient,
    documentType: string,
    fieldName: string
  ): Promise<string> {
    try {
      const samples = await client.fetch(
        `*[_type == $type && defined(${fieldName})][0...3].${fieldName}`,
        { type: documentType }
      ) as unknown[];

      if (samples && samples.length > 0) {
        return this.inferFieldType(samples[0]);
      }
      return 'unknown';
    } catch (e) {
      logger.warn(`Could not infer field type for ${documentType}.${fieldName}:`, e);
      return 'unknown';
    }
  }

  /**
   * Helper: Resolve a field value, auto-converting to Portable Text only if the
   * schema actually uses Portable Text for that field. Otherwise pass as plain string.
   */
  private async resolveFieldValue(
    client: SanityClient,
    documentType: string,
    fieldName: string,
    textValue: string
  ): Promise<string | Array<Record<string, unknown>>> {
    const fieldType = await this.getFieldTypeFromSchema(client, documentType, fieldName);
    logger.info(`Field ${documentType}.${fieldName} inferred as: ${fieldType}`);

    if (fieldType === 'portableText') {
      return this.textToPortableText(textValue);
    }
    // For string, unknown, or any other type, pass through as plain text
    return textValue;
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
   * Helper: Split text into chunks at natural boundaries (paragraphs, sentences, hard limit).
   */
  private chunkText(text: string, maxChunkSize: number): string[] {
    if (!text || text.length === 0) {
      return [];
    }
    if (text.length <= maxChunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    // Split into paragraphs first
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (!trimmed) continue;

      // If adding this paragraph fits, accumulate
      if (currentChunk.length + trimmed.length + 2 <= maxChunkSize) {
        currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed;
        continue;
      }

      // Push current chunk if non-empty
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      // If the paragraph itself fits in one chunk, start a new chunk with it
      if (trimmed.length <= maxChunkSize) {
        currentChunk = trimmed;
        continue;
      }

      // Paragraph exceeds chunk size — split by sentences
      const sentences = trimmed.split(/(?<=\.)\s+/);
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length + 1 <= maxChunkSize) {
          currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;
        } else {
          if (currentChunk) {
            chunks.push(currentChunk);
            currentChunk = '';
          }
          // If a single sentence exceeds chunk size, hard-split
          if (sentence.length > maxChunkSize) {
            let remaining = sentence;
            while (remaining.length > maxChunkSize) {
              chunks.push(remaining.slice(0, maxChunkSize - 3) + '...');
              remaining = remaining.slice(maxChunkSize - 3);
            }
            currentChunk = remaining;
          } else {
            currentChunk = sentence;
          }
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Helper: Extract all text content from a document, using pt::text extractions
   * for Portable Text fields and direct values for string fields.
   */
  private extractDocumentText(
    doc: Record<string, unknown>,
    ptTextFields: Record<string, string>
  ): string {
    const systemFields = new Set([
      '_id', '_type', '_rev', '_createdAt', '_updatedAt', '_key'
    ]);
    const sections: string[] = [];

    for (const [key, value] of Object.entries(doc)) {
      if (systemFields.has(key)) continue;

      // Use pt::text extraction if available
      const ptKey = `${key}Text`;
      if (ptTextFields[ptKey] && typeof ptTextFields[ptKey] === 'string') {
        const text = ptTextFields[ptKey].trim();
        if (text) {
          sections.push(`${this.formatFieldLabel(key)}: ${text}`);
        }
        continue;
      }

      // Handle different field types
      if (typeof value === 'string' && value.trim()) {
        sections.push(`${this.formatFieldLabel(key)}: ${value.trim()}`);
      } else if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        if (obj._type === 'slug' && obj.current) {
          sections.push(`${this.formatFieldLabel(key)}: ${obj.current}`);
        }
        // Skip images, references, and other complex objects
      }
    }

    return sections.join('\n\n');
  }

  /**
   * Helper: Format a field name as a readable label (e.g., "body" -> "Body")
   */
  private formatFieldLabel(fieldName: string): string {
    return fieldName.charAt(0).toUpperCase() + fieldName.slice(1).replace(/_/g, ' ');
  }

  /**
   * Helper: Analyze a document's fields and build a GROQ projection that extracts
   * plain text from all Portable Text fields using pt::text().
   */
  private buildTextExtractionProjection(doc: Record<string, unknown>): string {
    const ptFields: string[] = [];
    const systemFields = new Set([
      '_id', '_type', '_rev', '_createdAt', '_updatedAt', '_key'
    ]);

    for (const [key, value] of Object.entries(doc)) {
      if (systemFields.has(key)) continue;
      const fieldType = this.inferFieldType(value);
      if (fieldType === 'portableText') {
        ptFields.push(`"${key}Text": pt::text(${key})`);
      }
    }

    if (ptFields.length === 0) {
      return '{ ... }';
    }

    return `{ ..., ${ptFields.join(', ')} }`;
  }

  /**
   * Tool: Create a new document
   */
  @tool({
    name: 'create_document',
    description: 'Creates a new document in Sanity CMS as a draft. IMPORTANT: You MUST call get_document_types for the target type FIRST and ONLY set fields that exist in the schema. Do NOT guess field names — unknown fields will cause schema warnings in Sanity Studio. Use "name" for authors/categories, "title" for posts/pages. For image/asset references, use extra_fields with the exact field name from the schema (e.g., if the schema has a "photo" field, pass it via extra_fields). The tool auto-detects whether body/bio fields are Portable Text or plain string.',
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
        description: 'URL-friendly slug (e.g., "my-blog-post"). Auto-formatted as a Sanity slug object. ONLY use if get_document_types shows a "slug" field for this type.',
        required: false
      },
      {
        name: 'body',
        type: ParameterType.String,
        description: 'Body/content as plain text. The tool auto-detects the field type from the schema and converts to Portable Text if needed. Separate paragraphs with blank lines.',
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
        description: 'Bio as plain text. The tool auto-detects the field type from the schema and converts to Portable Text if needed.',
        required: false
      },
      {
        name: 'extra_fields',
        type: ParameterType.String,
        description: 'Additional fields as a simple JSON string for any fields not covered above. Use this for image/asset references with the exact field name from get_document_types. Example: {"photo": {"_type": "image", "asset": {"_type": "reference", "_ref": "image-abc123"}}}. ONLY include fields that exist in the schema.',
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

      // Auto-detect field types from schema before converting
      if (parameters.body) {
        document.body = await this.resolveFieldValue(
          client, parameters.document_type, 'body', parameters.body
        );
      }

      if (parameters.bio) {
        document.bio = await this.resolveFieldValue(
          client, parameters.document_type, 'bio', parameters.bio
        );
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
    description: 'Updates specific fields on an existing Sanity document. IMPORTANT: Call get_document_types FIRST and ONLY set fields that exist in the schema — unknown fields cause warnings in Sanity Studio. Use "name" for authors/categories, "title" for posts/pages. For image/asset references, use extra_fields with the exact field name from the schema. The tool auto-detects whether body/bio fields are Portable Text or plain string.',
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
        description: 'New URL-friendly slug. ONLY use if get_document_types shows a "slug" field for this document type.',
        required: false
      },
      {
        name: 'body',
        type: ParameterType.String,
        description: 'New body/content as plain text. The tool auto-detects the field type and converts to Portable Text if needed.',
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
        description: 'New bio as plain text. The tool auto-detects the field type and converts to Portable Text if needed.',
        required: false
      },
      {
        name: 'extra_fields',
        type: ParameterType.String,
        description: 'Additional fields as a simple JSON string. Use this for image/asset references with the exact field name from get_document_types. Example: {"mainImage": {"_type": "image", "asset": {"_type": "reference", "_ref": "image-abc123"}}}. ONLY include fields that exist in the schema.',
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

      // Fetch the existing document to determine its _type for schema lookups
      const existingDoc = await client.getDocument(parameters.document_id);
      const documentType = (existingDoc?._type as string) || '';

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

      // Auto-detect field types from schema before converting
      if (parameters.body) {
        updates.body = documentType
          ? await this.resolveFieldValue(client, documentType, 'body', parameters.body)
          : parameters.body;
      }

      if (parameters.bio) {
        updates.bio = documentType
          ? await this.resolveFieldValue(client, documentType, 'bio', parameters.bio)
          : parameters.bio;
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
    description: 'Searches content in Sanity CMS using full-text search with relevance scoring. Useful for RAG (Retrieval-Augmented Generation) to find relevant content. Optionally include longer text previews for scanning results before full retrieval.',
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
      },
      {
        name: 'include_text_preview',
        type: ParameterType.Boolean,
        description: 'When true, includes a longer text preview (~200 chars) from the body for each result. Useful for scanning results before full retrieval. Defaults to false.',
        required: false
      },
      {
        name: 'search_fields',
        type: ParameterType.String,
        description: 'Comma-separated list of additional field names to search in, beyond the defaults (title, name, body, description, content, text). E.g., "summary,subtitle".',
        required: false
      }
    ]
  })
  async searchContent(
    parameters: {
      search_query: string;
      document_types?: string[];
      limit?: number;
      include_text_preview?: boolean;
      search_fields?: string;
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

      // Build field list (default + custom)
      const defaultFields = ['title', 'name', 'body', 'description', 'content', 'text'];
      const extraFields = parameters.search_fields
        ? parameters.search_fields.split(',').map(f => f.trim()).filter(f => f)
        : [];
      const allSearchFields = [...new Set([...defaultFields, ...extraFields])];
      const fieldList = `[${allSearchFields.join(', ')}]`;

      // Build projection with optional text preview
      let excerptProjection: string;
      if (parameters.include_text_preview) {
        excerptProjection = `"excerpt": coalesce(
          description,
          pt::text(body[0..2]),
          pt::text(content[0..2])
        ),
        "text_preview": coalesce(
          pt::text(body[0..5]),
          pt::text(content[0..5]),
          description
        )`;
      } else {
        excerptProjection = `"excerpt": coalesce(
          description,
          pt::text(body[0..2]),
          pt::text(content[0..2])
        )`;
      }

      const groqQuery = `*[${typeFilter}${fieldList} match $searchTerm] | score(
        boost([title, name] match $searchTerm, 3),
        boost([description] match $searchTerm, 2),
        ${fieldList} match $searchTerm
      ) | order(_score desc) [0...${maxResults}] {
        _id,
        _type,
        _score,
        title,
        name,
        slug,
        description,
        ${excerptProjection}
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

  /**
   * Tool: Upload an asset from base64-encoded data or a public URL
   */
  @tool({
    name: 'upload_asset',
    description: 'Uploads an image or file to Sanity. Returns an asset reference object. To attach the asset to a document, call get_document_types FIRST to find the exact image field name (e.g., "mainImage", "photo", "avatar"), then pass the returned reference via create_document or update_document extra_fields using that field name. Do NOT guess the field name. Provide EITHER base64-encoded data (with content_type) OR a publicly accessible URL. IMPORTANT: The URL must be publicly accessible without authentication — authenticated or internal URLs will fail with a 401 error. When in doubt, prefer base64.',
    endpoint: '/tools/upload-asset',
    parameters: [
      {
        name: 'data',
        type: ParameterType.String,
        description: 'Base64-encoded file content. Do not include the data URI prefix (e.g., "data:image/png;base64,") — pass only the raw base64 string. Provide this OR url, not both.',
        required: false
      },
      {
        name: 'url',
        type: ParameterType.String,
        description: 'A publicly accessible URL to fetch the file from. Must NOT require authentication — only unauthenticated public URLs are supported. Provide this OR data, not both.',
        required: false
      },
      {
        name: 'content_type',
        type: ParameterType.String,
        description: 'The MIME type of the file (e.g., "image/png", "image/jpeg", "application/pdf"). Required when using data. When using url, it is auto-detected from the response but can be overridden here.',
        required: false
      },
      {
        name: 'asset_type',
        type: ParameterType.String,
        description: 'Type of asset: "image" or "file". Defaults to "image".',
        required: false
      },
      {
        name: 'filename',
        type: ParameterType.String,
        description: 'Optional filename for the uploaded asset (e.g., "avatar.png"). If omitted, a default name is generated.',
        required: false
      },
      {
        name: 'title',
        type: ParameterType.String,
        description: 'Optional title/alt text for the asset',
        required: false
      }
    ]
  })
  async uploadAsset(
    parameters: {
      data?: string;
      url?: string;
      content_type?: string;
      asset_type?: string;
      filename?: string;
      title?: string;
    },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    asset_id?: string;
    asset_url?: string;
    reference?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();

      let buffer: Buffer;
      let contentType = parameters.content_type || '';
      let filename = parameters.filename || '';

      if (parameters.data) {
        // --- Base64 path ---
        if (!parameters.content_type) {
          return {
            success: false,
            error: 'content_type is required when uploading from base64 data.'
          };
        }

        // Strip data URI prefix if accidentally included
        let base64Data = parameters.data;
        const dataUriMatch = base64Data.match(/^data:[^;]+;base64,(.+)$/);
        if (dataUriMatch) {
          base64Data = dataUriMatch[1];
        }

        buffer = Buffer.from(base64Data, 'base64');

        if (buffer.length === 0) {
          return {
            success: false,
            error: 'Decoded data is empty. Ensure the base64 string is valid.'
          };
        }

        if (!filename) {
          filename = `asset-${Date.now()}${this.extensionFromMime(contentType)}`;
        }
      } else if (parameters.url) {
        // --- URL path ---
        const response = await fetch(parameters.url);
        if (!response.ok) {
          return {
            success: false,
            error: `Failed to fetch URL (${response.status} ${response.statusText}). Ensure the URL is publicly accessible without authentication.`
          };
        }

        buffer = Buffer.from(await response.arrayBuffer());

        // Use Content-Type from response if not explicitly provided
        if (!contentType) {
          contentType = response.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream';
        }

        // Extract filename from URL if not provided
        if (!filename) {
          const urlPath = new URL(parameters.url).pathname;
          const urlFilename = urlPath.split('/').pop();
          filename = urlFilename && urlFilename.includes('.') ? urlFilename : `asset-${Date.now()}${this.extensionFromMime(contentType)}`;
        }
      } else {
        return {
          success: false,
          error: 'Either "data" (base64 string) or "url" (public URL) must be provided.'
        };
      }

      // Determine asset type
      const assetType = parameters.asset_type === 'file' ? 'file' : 'image';

      // Upload to Sanity
      const uploadOptions: { filename: string; contentType: string; title?: string } = {
        filename,
        contentType
      };
      if (parameters.title) {
        uploadOptions.title = parameters.title;
      }

      const asset = await client.assets.upload(assetType, buffer, uploadOptions);

      // Build reference object for use in documents
      const reference = {
        _type: assetType,
        asset: {
          _type: 'reference',
          _ref: asset._id
        }
      };

      return {
        success: true,
        asset_id: asset._id,
        asset_url: asset.url,
        reference
      };
    } catch (error) {
      logger.error('Error uploading asset:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Helper: Map a MIME type to a file extension
   */
  private extensionFromMime(mime: string): string {
    const map: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'image/tiff': '.tiff',
      'application/pdf': '.pdf',
      'video/mp4': '.mp4',
      'audio/mpeg': '.mp3',
    };
    return map[mime] || '';
  }

  /**
   * Tool: Extract full text from a specific document, chunked for LLM consumption
   */
  @tool({
    name: 'get_document_text',
    description: 'Extracts the full plain text content from a specific Sanity document, chunked for LLM consumption. Use when you already have a document ID and need its text content. Portable Text fields are automatically converted to plain text.',
    endpoint: '/tools/document-text',
    parameters: [
      {
        name: 'document_id',
        type: ParameterType.String,
        description: 'The ID of the document to extract text from',
        required: true
      },
      {
        name: 'max_chars',
        type: ParameterType.Number,
        description: 'Maximum total characters to return. Defaults to the configured content_chunk_size. Set to 0 for unlimited.',
        required: false
      },
      {
        name: 'fields',
        type: ParameterType.List,
        description: 'Specific fields to extract text from (e.g., ["body", "description"]). If omitted, extracts from all text fields.',
        required: false
      }
    ]
  })
  async getDocumentText(
    parameters: {
      document_id: string;
      max_chars?: number;
      fields?: string[];
    },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    document_id?: string;
    document_type?: string;
    title?: string;
    chunks?: Array<{
      chunk_index: number;
      total_chunks: number;
      text: string;
      char_count: number;
    }>;
    total_chars?: number;
    total_chunks?: number;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();
      const ragSettings = await this.getRagSettings();
      const chunkSize = parseInt(ragSettings.content_chunk_size || '1000', 10);

      // Fetch the raw document
      const doc = await client.getDocument(parameters.document_id) as Record<string, unknown> | undefined;
      if (!doc) {
        return {
          success: false,
          error: `Document "${parameters.document_id}" not found`
        };
      }

      // Build pt::text projection for Portable Text fields
      const projection = this.buildTextExtractionProjection(doc);
      const enriched = await client.fetch(
        `*[_id == $id]${projection}[0]`,
        { id: parameters.document_id }
      ) as Record<string, unknown>;

      // Separate pt::text fields from the enriched result
      const ptTextFields: Record<string, string> = {};
      for (const [key, value] of Object.entries(enriched)) {
        if (key.endsWith('Text') && typeof value === 'string') {
          ptTextFields[key] = value;
        }
      }

      // Filter to requested fields if specified
      let sourceDoc = doc;
      if (parameters.fields && parameters.fields.length > 0) {
        const filtered: Record<string, unknown> = {};
        for (const field of parameters.fields) {
          if (doc[field] !== undefined) {
            filtered[field] = doc[field];
          }
        }
        sourceDoc = filtered;
      }

      // Extract text
      const fullText = this.extractDocumentText(sourceDoc, ptTextFields);
      if (!fullText) {
        return {
          success: true,
          document_id: parameters.document_id,
          document_type: doc._type as string,
          title: (doc.title || doc.name || '') as string,
          chunks: [],
          total_chars: 0,
          total_chunks: 0
        };
      }

      // Chunk the text
      let textChunks = this.chunkText(fullText, chunkSize);

      // Apply max_chars budget if specified (0 = unlimited)
      const maxChars = parameters.max_chars;
      if (maxChars !== undefined && maxChars !== 0 && maxChars > 0) {
        let charBudget = maxChars;
        const budgeted: string[] = [];
        for (const chunk of textChunks) {
          if (charBudget <= 0) break;
          if (chunk.length <= charBudget) {
            budgeted.push(chunk);
            charBudget -= chunk.length;
          } else {
            budgeted.push(chunk.slice(0, charBudget - 3) + '...');
            charBudget = 0;
          }
        }
        textChunks = budgeted;
      }

      const totalChunks = textChunks.length;
      const chunks = textChunks.map((text, index) => ({
        chunk_index: index,
        total_chunks: totalChunks,
        text,
        char_count: text.length
      }));

      return {
        success: true,
        document_id: parameters.document_id,
        document_type: doc._type as string,
        title: (doc.title || doc.name || '') as string,
        chunks,
        total_chars: chunks.reduce((sum, c) => sum + c.char_count, 0),
        total_chunks: totalChunks
      };
    } catch (error) {
      logger.error('Error extracting document text:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Tool: Retrieve context — the primary RAG tool.
   * Searches for relevant content, fetches full documents, extracts and chunks text,
   * and returns LLM-ready context blocks.
   */
  @tool({
    name: 'retrieve_context',
    description: 'Primary RAG tool. Searches Sanity content, fetches full documents, extracts text (including Portable Text), chunks it, and returns LLM-ready context blocks with relevance scores. Use this to gather context for answering questions about content.',
    endpoint: '/tools/retrieve-context',
    parameters: [
      {
        name: 'query',
        type: ParameterType.String,
        description: 'The search query or topic to find relevant content for',
        required: true
      },
      {
        name: 'document_types',
        type: ParameterType.List,
        description: 'Document types to search (e.g., ["post", "page"]). Defaults to configured default types or all types.',
        required: false
      },
      {
        name: 'max_results',
        type: ParameterType.Number,
        description: 'Maximum number of source documents to retrieve (1-20). Defaults to 5.',
        required: false
      },
      {
        name: 'max_chars',
        type: ParameterType.Number,
        description: 'Total character budget for all returned chunks combined. Defaults to chunk_size * max_results. Set to 0 for unlimited.',
        required: false
      },
      {
        name: 'include_metadata',
        type: ParameterType.Boolean,
        description: 'Whether to include document metadata (type, id, title, date) with each chunk. Defaults to true.',
        required: false
      }
    ]
  })
  async retrieveContext(
    parameters: {
      query: string;
      document_types?: string[];
      max_results?: number;
      max_chars?: number;
      include_metadata?: boolean;
    },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    chunks?: Array<{
      document_id: string;
      document_type: string;
      title: string;
      updated_at: string;
      relevance_score: number;
      chunk_index: number;
      total_chunks: number;
      text: string;
      char_count: number;
    }>;
    total_chunks?: number;
    total_chars?: number;
    sources_used?: number;
    query?: string;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();
      const ragSettings = await this.getRagSettings();
      const contentSettings = await storage.settings.get('content_settings') as unknown as ContentSettings | null;
      const chunkSize = parseInt(ragSettings.content_chunk_size || '1000', 10);
      const maxResults = Math.min(parameters.max_results || 5, 20);
      const includeMetadata = parameters.include_metadata !== false;

      // Step 1: Search for relevant documents (reuse search_content GROQ pattern)
      let typeFilter = '';
      const types = parameters.document_types ||
        (contentSettings?.default_document_types
          ? contentSettings.default_document_types.split(',').map(t => t.trim())
          : null);

      if (types && types.length > 0) {
        typeFilter = `_type in [${types.map(t => `"${t}"`).join(', ')}] && `;
      }

      const searchQuery = `*[${typeFilter}[title, name, body, description, content, text] match $searchTerm] | score(
        boost([title, name] match $searchTerm, 3),
        boost([description] match $searchTerm, 2),
        [body, content, text] match $searchTerm
      ) | order(_score desc) [0...${maxResults}] {
        _id,
        _type,
        _score,
        _updatedAt,
        title,
        name
      }`;

      const searchResults = await client.fetch(searchQuery, {
        searchTerm: `*${parameters.query}*`
      }) as Array<Record<string, unknown>>;

      if (!searchResults || searchResults.length === 0) {
        return {
          success: true,
          chunks: [],
          total_chunks: 0,
          total_chars: 0,
          sources_used: 0,
          query: parameters.query
        };
      }

      // Step 2: Fetch full content for each result with pt::text extraction
      const resultIds = searchResults.map(r => r._id as string);

      // Sample first result to discover PT fields for projection
      const sampleDoc = await client.getDocument(resultIds[0]) as Record<string, unknown>;
      const projection = this.buildTextExtractionProjection(sampleDoc || {});

      const fullDocs = await client.fetch(
        `*[_id in $ids]${projection}`,
        { ids: resultIds }
      ) as Array<Record<string, unknown>>;

      // Build a lookup of search metadata by _id
      const searchMeta: Record<string, Record<string, unknown>> = {};
      for (const result of searchResults) {
        searchMeta[result._id as string] = result;
      }

      // Step 3: Extract text, chunk, and assemble context blocks
      const allChunks: Array<{
        document_id: string;
        document_type: string;
        title: string;
        updated_at: string;
        relevance_score: number;
        chunk_index: number;
        total_chunks: number;
        text: string;
        char_count: number;
      }> = [];

      const defaultMaxChars = chunkSize * maxResults;
      const maxChars = parameters.max_chars !== undefined && parameters.max_chars !== 0
        ? parameters.max_chars
        : defaultMaxChars;
      let charBudget = maxChars > 0 ? maxChars : Infinity;
      const sourcesUsed = new Set<string>();

      for (const doc of fullDocs) {
        if (charBudget <= 0) break;

        const docId = doc._id as string;
        const meta = searchMeta[docId] || {};

        // Separate pt::text fields
        const ptTextFields: Record<string, string> = {};
        for (const [key, value] of Object.entries(doc)) {
          if (key.endsWith('Text') && typeof value === 'string') {
            ptTextFields[key] = value;
          }
        }

        // Extract and chunk text
        const fullText = this.extractDocumentText(doc, ptTextFields);
        if (!fullText) continue;

        const textChunks = this.chunkText(fullText, chunkSize);
        const docTitle = (meta.title || meta.name || doc.title || doc.name || '') as string;
        const docType = (doc._type || '') as string;
        const updatedAt = (meta._updatedAt || doc._updatedAt || '') as string;
        const score = (meta._score || 0) as number;

        for (let i = 0; i < textChunks.length; i++) {
          if (charBudget <= 0) break;

          let chunkText = textChunks[i];
          if (chunkText.length > charBudget) {
            chunkText = chunkText.slice(0, charBudget - 3) + '...';
          }

          // Prepend metadata header if requested
          let text = chunkText;
          if (includeMetadata && i === 0) {
            const header = `[${docType}] ${docTitle} (ID: ${docId})`;
            text = `${header}\n\n${chunkText}`;
          }

          allChunks.push({
            document_id: docId,
            document_type: docType,
            title: docTitle,
            updated_at: updatedAt,
            relevance_score: score,
            chunk_index: i,
            total_chunks: textChunks.length,
            text,
            char_count: text.length
          });

          charBudget -= text.length;
          sourcesUsed.add(docId);
        }
      }

      return {
        success: true,
        chunks: allChunks,
        total_chunks: allChunks.length,
        total_chars: allChunks.reduce((sum, c) => sum + c.char_count, 0),
        sources_used: sourcesUsed.size,
        query: parameters.query
      };
    } catch (error) {
      logger.error('Error retrieving context:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Tool: Get a structured catalog of available content in Sanity
   */
  @tool({
    name: 'get_content_catalog',
    description: 'Returns a structured overview of content available in Sanity CMS — document types, counts, searchable fields, and sample content. Use this to understand what content exists before making retrieve_context or search_content calls.',
    endpoint: '/tools/content-catalog',
    parameters: [
      {
        name: 'document_type',
        type: ParameterType.String,
        description: 'Get detailed catalog for a specific type (e.g., "post"). If omitted, returns a summary of all types.',
        required: false
      },
      {
        name: 'include_samples',
        type: ParameterType.Boolean,
        description: 'Whether to include sample document titles/names. Defaults to true. Max 5 samples per type.',
        required: false
      }
    ]
  })
  async getContentCatalog(
    parameters: {
      document_type?: string;
      include_samples?: boolean;
    },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    catalog?: {
      total_documents: number;
      total_types: number;
      types: Array<{
        type: string;
        count: number;
        searchable_fields: string[];
        all_fields: Array<{ name: string; type: string }>;
        samples?: Array<{ _id: string; title_or_name: string; updated_at: string }>;
        date_range?: { earliest: string; latest: string };
        avg_text_length?: number;
      }>;
    };
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();
      const includeSamples = parameters.include_samples !== false;

      if (parameters.document_type) {
        // Detail mode for a specific type
        const docType = parameters.document_type;
        const count = await client.fetch(
          `count(*[_type == $type])`,
          { type: docType }
        ) as number;

        // Sample documents to discover fields
        const samples = await client.fetch(
          `*[_type == $type] | order(_updatedAt desc) [0...5]`,
          { type: docType }
        ) as Array<Record<string, unknown>>;

        // Infer field types from samples
        const fieldTypes: Record<string, string> = {};
        for (const doc of samples) {
          for (const [key, value] of Object.entries(doc)) {
            if (!fieldTypes[key] || fieldTypes[key] === 'unknown') {
              fieldTypes[key] = this.inferFieldType(value);
            }
          }
        }

        const allFields = Object.entries(fieldTypes)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, type]) => ({ name, type }));

        // Identify searchable text fields
        const textTypes = new Set(['string', 'portableText']);
        const systemFields = new Set(['_id', '_type', '_rev', '_createdAt', '_updatedAt', '_key']);
        const searchableFields = allFields
          .filter(f => textTypes.has(f.type) && !systemFields.has(f.name))
          .map(f => f.name);

        // Date range
        const dateRange = await client.fetch(
          `{ "earliest": *[_type == $type] | order(_updatedAt asc)[0]._updatedAt, "latest": *[_type == $type] | order(_updatedAt desc)[0]._updatedAt }`,
          { type: docType }
        ) as { earliest: string; latest: string };

        // Estimate avg text length from samples
        let avgTextLength: number | undefined;
        if (samples.length > 0) {
          // Build projection for first sample to extract text
          const projection = this.buildTextExtractionProjection(samples[0]);
          const enrichedSamples = await client.fetch(
            `*[_type == $type] | order(_updatedAt desc) [0...3]${projection}`,
            { type: docType }
          ) as Array<Record<string, unknown>>;

          let totalLen = 0;
          for (const doc of enrichedSamples) {
            const ptTextFields: Record<string, string> = {};
            for (const [key, value] of Object.entries(doc)) {
              if (key.endsWith('Text') && typeof value === 'string') {
                ptTextFields[key] = value;
              }
            }
            totalLen += this.extractDocumentText(doc, ptTextFields).length;
          }
          avgTextLength = Math.round(totalLen / enrichedSamples.length);
        }

        // Build sample list
        let sampleList: Array<{ _id: string; title_or_name: string; updated_at: string }> | undefined;
        if (includeSamples && samples.length > 0) {
          sampleList = samples.map(s => ({
            _id: s._id as string,
            title_or_name: (s.title || s.name || '(untitled)') as string,
            updated_at: (s._updatedAt || '') as string
          }));
        }

        return {
          success: true,
          catalog: {
            total_documents: count,
            total_types: 1,
            types: [{
              type: docType,
              count,
              searchable_fields: searchableFields,
              all_fields: allFields,
              samples: sampleList,
              date_range: dateRange,
              avg_text_length: avgTextLength
            }]
          }
        };
      }

      // Summary mode — all types
      // Get unique types with counts efficiently
      const typeData = await client.fetch(
        `*[!(_type match "system.*") && !(_type match "sanity.*")]._type`
      ) as string[];

      const typeCounts: Record<string, number> = {};
      for (const t of typeData) {
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      }

      const totalDocuments = typeData.length;
      const typeNames = Object.keys(typeCounts).sort();

      const catalogTypes: Array<{
        type: string;
        count: number;
        searchable_fields: string[];
        all_fields: Array<{ name: string; type: string }>;
        samples?: Array<{ _id: string; title_or_name: string; updated_at: string }>;
        date_range?: { earliest: string; latest: string };
      }> = [];

      for (const typeName of typeNames) {
        // Fetch one sample to discover fields
        const sample = await client.fetch(
          `*[_type == $type] | order(_updatedAt desc) [0]`,
          { type: typeName }
        ) as Record<string, unknown> | null;

        const allFields: Array<{ name: string; type: string }> = [];
        const searchableFields: string[] = [];
        const textTypes = new Set(['string', 'portableText']);
        const systemFields = new Set(['_id', '_type', '_rev', '_createdAt', '_updatedAt', '_key']);

        if (sample) {
          for (const [key, value] of Object.entries(sample)) {
            const fieldType = this.inferFieldType(value);
            allFields.push({ name: key, type: fieldType });
            if (textTypes.has(fieldType) && !systemFields.has(key)) {
              searchableFields.push(key);
            }
          }
          allFields.sort((a, b) => a.name.localeCompare(b.name));
        }

        // Build sample list
        let sampleList: Array<{ _id: string; title_or_name: string; updated_at: string }> | undefined;
        if (includeSamples) {
          const recentDocs = await client.fetch(
            `*[_type == $type] | order(_updatedAt desc) [0...3] { _id, title, name, _updatedAt }`,
            { type: typeName }
          ) as Array<Record<string, unknown>>;

          sampleList = recentDocs.map(d => ({
            _id: d._id as string,
            title_or_name: (d.title || d.name || '(untitled)') as string,
            updated_at: (d._updatedAt || '') as string
          }));
        }

        catalogTypes.push({
          type: typeName,
          count: typeCounts[typeName],
          searchable_fields: searchableFields,
          all_fields: allFields,
          samples: sampleList
        });
      }

      return {
        success: true,
        catalog: {
          total_documents: totalDocuments,
          total_types: typeNames.length,
          types: catalogTypes
        }
      };
    } catch (error) {
      logger.error('Error building content catalog:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}
