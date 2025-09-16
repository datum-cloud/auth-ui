declare namespace NodeJS {
  interface ProcessEnv {
    // Allow any environment variable that matches the pattern
    [key: `${string}_AUDIENCE`]: string; // The system api url
    [key: `${string}_SYSTEM_USER_ID`]: string; // The service user id
    [key: `${string}_SYSTEM_USER_PRIVATE_KEY`]: string; // The service user private key

    AUDIENCE: string; // The fallback system api url
    SYSTEM_USER_ID: string; // The fallback service user id
    SYSTEM_USER_PRIVATE_KEY: string; // The fallback service user private key

    /**
     * The Zitadel API url
     */
    ZITADEL_API_URL: string;

    /**
     * The service user token
     */
    ZITADEL_SERVICE_USER_TOKEN: string;

    /**
     * Optional: wheter a user must have verified email
     */
    EMAIL_VERIFICATION: string;

    /**
     * Optional: custom request headers to be added to every request
     * Split by comma, key value pairs separated by colon
     */
    CUSTOM_REQUEST_HEADERS?: string;

    /**
     * Optional: whether to enable the Zitadel API translation
     */
    ENABLE_ZITADEL_API_TRANSLATION?: string | boolean;

    /**
     * Optional: the Marker.io project id
     */
    MARKER_IO_PROJECT_ID?: string;

    /**
     * Optional: the Fathom analytics id
     */
    FATHOM_ID?: string;
  }
}
