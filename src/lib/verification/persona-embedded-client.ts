"use client";

export type PersonaEmbeddedResult =
  | { status: "completed"; inquiryId: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

type OpenPersonaEmbeddedInquiryParams = {
  inquiryId: string;
  environmentId: string;
  sessionToken?: string | null;
};

export async function openPersonaEmbeddedInquiry(
  params: OpenPersonaEmbeddedInquiryParams,
): Promise<PersonaEmbeddedResult> {
  const { Client } = await import("persona");

  return new Promise((resolve) => {
    let client: InstanceType<typeof Client> | null = null;

    const finish = (result: PersonaEmbeddedResult) => {
      client?.destroy();
      client = null;
      resolve(result);
    };

    client = new Client({
      inquiryId: params.inquiryId,
      environmentId: params.environmentId,
      ...(params.sessionToken ? { sessionToken: params.sessionToken } : {}),
      onReady: () => client?.open(),
      onComplete: ({ inquiryId }) => {
        finish({ status: "completed", inquiryId });
      },
      onCancel: () => {
        finish({ status: "cancelled" });
      },
      onError: (error) => {
        const message =
          typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
            ? error.message
            : "Persona verification failed";
        finish({ status: "error", message });
      },
    });
  });
}
