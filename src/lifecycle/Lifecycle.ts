import {
  Lifecycle as BaseLifecycle,
  SubmittedFormData,
  LifecycleSettingsResult,
  AuthorizationGrantResult,
  Request,
  LifecycleResult,
  logger,
  storage
} from '@zaiusinc/app-sdk';

/**
 * Lifecycle hooks for the Sanity Content Tool.
 * These methods are called by OCP during app installation, upgrade, and uninstallation.
 */
export class Lifecycle extends BaseLifecycle {
  /**
   * Called when the app is installed to an OCP account.
   */
  public async onInstall(): Promise<LifecycleResult> {
    logger.info('Sanity Content Tool: onInstall called');
    return { success: true };
  }

  /**
   * Handle a submission of a form section.
   * Validates Sanity connection settings before saving.
   */
  public async onSettingsForm(
    section: string,
    action: string,
    formData: SubmittedFormData
  ): Promise<LifecycleSettingsResult> {
    logger.info(`Sanity Content Tool: onSettingsForm called for section ${section}, action ${action}`);

    const result = new LifecycleSettingsResult();
    let hasValidationErrors = false;

    // Validate Sanity connection settings
    if (section === 'sanity_connection') {
      const projectId = formData.project_id as string;
      const dataset = formData.dataset as string;
      const apiToken = formData.api_token as string;

      if (!projectId || projectId.trim() === '') {
        result.addError('project_id', 'Project ID is required');
        hasValidationErrors = true;
      }

      if (!dataset || dataset.trim() === '') {
        result.addError('dataset', 'Dataset is required');
        hasValidationErrors = true;
      }

      if (!apiToken || apiToken.trim() === '') {
        result.addError('api_token', 'API Token is required');
        hasValidationErrors = true;
      }

      // If there are errors, return early
      if (hasValidationErrors) {
        return result;
      }
    }

    // Save the form data to storage
    await storage.settings.put(section, formData);

    return result;
  }

  /**
   * Called when the app is upgraded to a new version.
   */
  public async onUpgrade(fromVersion: string): Promise<LifecycleResult> {
    logger.info(`Sanity Content Tool: onUpgrade called from version ${fromVersion}`);
    return { success: true };
  }

  /**
   * Called after upgrade is complete.
   */
  public async onFinalizeUpgrade(fromVersion: string): Promise<LifecycleResult> {
    logger.info(`Sanity Content Tool: onFinalizeUpgrade called from version ${fromVersion}`);
    return { success: true };
  }

  /**
   * Called when the app is uninstalled from an OCP account.
   */
  public async onUninstall(): Promise<LifecycleResult> {
    logger.info('Sanity Content Tool: onUninstall called');
    return { success: true };
  }

  /**
   * Handles outbound OAuth requests.
   * This app uses API tokens instead of OAuth.
   */
  public async onAuthorizationRequest(
    section: string,
    formData: SubmittedFormData
  ): Promise<LifecycleSettingsResult> {
    logger.info(`Sanity Content Tool: onAuthorizationRequest called for section ${section}`);
    return new LifecycleSettingsResult()
      .addError('oauth', 'This app uses API tokens for authentication. Please configure your Sanity API token in the settings.');
  }

  /**
   * Handles inbound OAuth grants.
   * This app uses API tokens instead of OAuth.
   */
  public async onAuthorizationGrant(request: Request): Promise<AuthorizationGrantResult> {
    logger.info('Sanity Content Tool: onAuthorizationGrant called');
    return new AuthorizationGrantResult('sanity_connection')
      .addError('oauth', 'This app uses API tokens for authentication. Please configure your Sanity API token in the settings.');
  }
}
