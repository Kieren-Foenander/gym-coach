import Constants from "expo-constants"

/**
 * A build for the end-to-end tests (app.config.ts): it signs in to a server on the test machine. It differs
 * from a real build only where the tests need it to.
 */
export const END_TO_END_BUILD = Constants.expoConfig?.extra?.endToEndBuild === true
