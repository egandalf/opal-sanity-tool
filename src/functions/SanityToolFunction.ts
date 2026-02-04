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
    description: 'Executes a GROQ query against Sanity CMS. GROQ is Sanity\'s query language. Example: *[_type == "post"]{title, slug}',
    endpoint: '/tools/query-documents',
    parameters: [
      {
        name: 'query',
        type: ParameterType.String,
        description: 'The GROQ query to execute',
        required: true
      },
      {
        name: 'params',
        type: ParameterType.Dictionary,
        description: 'Optional parameters to pass to the query (e.g., {"type": "post"})',
        required: false
      }
    ]
  })
  async queryDocuments(
    parameters: { query: string; params?: Record<string, unknown> },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    results?: unknown[];
    count?: number;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();
      const results = await client.fetch(parameters.query, parameters.params || {});

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
   * Tool: Create a new document
   */
  @tool({
    name: 'create_document',
    description: 'Creates a new document in Sanity CMS. The document will be created as a draft by default.',
    endpoint: '/tools/create-document',
    parameters: [
      {
        name: 'document_type',
        type: ParameterType.String,
        description: 'The type of document to create (e.g., "post", "page", "article")',
        required: true
      },
      {
        name: 'document_data',
        type: ParameterType.Dictionary,
        description: 'The document data as a JSON object. Should include all required fields for the document type.',
        required: true
      },
      {
        name: 'publish',
        type: ParameterType.Boolean,
        description: 'Whether to publish the document immediately after creation. Default is false (creates as draft).',
        required: false
      }
    ]
  })
  async createDocument(
    parameters: {
      document_type: string;
      document_data: Record<string, unknown>;
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

      const document = {
        _type: parameters.document_type,
        ...parameters.document_data
      };

      const result = await client.create(document);

      // If publish is requested, publish the document
      if (parameters.publish && result._id) {
        await client
          .patch(result._id)
          .set({ _id: result._id.replace('drafts.', '') })
          .commit();
      }

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
    description: 'Updates an existing document in Sanity CMS. Only the specified fields will be updated.',
    endpoint: '/tools/update-document',
    parameters: [
      {
        name: 'document_id',
        type: ParameterType.String,
        description: 'The ID of the document to update',
        required: true
      },
      {
        name: 'updates',
        type: ParameterType.Dictionary,
        description: 'The fields to update as a JSON object',
        required: true
      }
    ]
  })
  async updateDocument(
    parameters: {
      document_id: string;
      updates: Record<string, unknown>;
    },
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    document?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();

      const result = await client
        .patch(parameters.document_id)
        .set(parameters.updates)
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
      const groqQuery = `*[${typeFilter}[title, body, description, content, text] match $searchTerm] | score(
        boost([title] match $searchTerm, 3),
        boost([description] match $searchTerm, 2),
        [body, content, text] match $searchTerm
      ) | order(_score desc) [0...${maxResults}] {
        _id,
        _type,
        _score,
        title,
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
    description: 'Returns a list of document types available in the Sanity dataset, based on existing documents.',
    endpoint: '/tools/get-document-types',
    parameters: []
  })
  async getDocumentTypes(
    parameters: Record<string, never>,
    authData?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    types?: Array<{
      type: string;
      count: number;
    }>;
    error?: string;
  }> {
    try {
      const client = await this.getSanityClient();

      // Query to get unique document types and their counts
      const query = `{
        "types": *[!(_type match "system.*") && !(_type match "sanity.*")] {
          _type
        } | order(_type asc)
      }`;

      const result = await client.fetch(query);

      // Count occurrences of each type
      const typeCounts: Record<string, number> = {};
      for (const doc of result.types) {
        typeCounts[doc._type] = (typeCounts[doc._type] || 0) + 1;
      }

      const types = Object.entries(typeCounts).map(([type, count]) => ({
        type,
        count
      }));

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
