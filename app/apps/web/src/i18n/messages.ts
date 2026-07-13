export type MessageParams = Record<string, string | number>;

export const format = (template: string, params: MessageParams): string =>
  template.replace(/\{(\w+)\}/g, (_match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`,
  );

export interface Messages {
  common: {
    appName: string;
    language: string;
    languagePolish: string;
    languageEnglish: string;
    loading: string;
  };
  auth: {
    signInTitle: string;
    signInEyebrow: (params: { tenant: string }) => string;
    emailLabel: string;
    passwordLabel: string;
    signInIdle: string;
    signInPending: string;
    passkeyIdle: string;
    passkeyPending: string;
    continueWithGoogle: string;
    magicLinkEmailLabel: string;
    magicLinkIdle: string;
    magicLinkPending: string;
    magicLinkRequested: string;
    magicLinkFetching: string;
    openMagicLink: string;
    registerPrompt: string;
    registerLink: string;
  };
  panel: {
    productsTitle: string;
    membersTitle: string;
    coursesTitle: string;
    emptyProducts: string;
  };
  student: {
    myCoursesTitle: string;
    myProductsTitle: string;
    continueLesson: string;
    lockedLesson: string;
  };
  checkout: {
    loading: string;
    eyebrow: (params: { tenant: string }) => string;
    unavailableTitle: string;
    unavailableBody: string;
    paymentSimulatedEyebrow: string;
    accessGrantedTitle: string;
    productionNote: string;
    noMagicLinkNote: string;
    openCourse: string;
    emailLabel: string;
    submitIdle: string;
    submitPending: string;
  };
}
