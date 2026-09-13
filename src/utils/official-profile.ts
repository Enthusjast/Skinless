export type OfficialSkinModel = "classic" | "slim";

export interface OfficialProfile {
  id: string;
  name: string;
  skinUrl: string;
  capeUrl: string | null;
  model: OfficialSkinModel;
}

export class OfficialProfileError extends Error {
  public constructor(
    public readonly code:
      "invalid_username" | "not_found" | "unavailable" | "invalid_profile",
    message: string,
  ) {
    super(message);
    this.name = "OfficialProfileError";
  }
}

type Fetcher = typeof fetch;

const LOOKUP_URL =
  "https://api.minecraftservices.com/minecraft/profile/lookup/name/";
const SESSION_PROFILE_URL =
  "https://sessionserver.mojang.com/session/minecraft/profile/";
const TEXTURE_HOST = "textures.minecraft.net";
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const UUID_PATTERN = /^[0-9a-f]{32}$/i;
const TEXTURE_PATH_PATTERN = /^\/texture\/([0-9a-f]{64})$/i;
const REQUEST_TIMEOUT_MS = 8_000;

function decodeBase64Json(value: string): Record<string, unknown> {
  try {
    const bytes = Uint8Array.from(atob(value), (character) =>
      character.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
  } catch {
    throw new OfficialProfileError(
      "invalid_profile",
      "The official profile texture data is invalid.",
    );
  }
}

function officialTextureUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const match =
      url.hostname === TEXTURE_HOST
        ? url.pathname.match(TEXTURE_PATH_PATTERN)
        : null;
    return match ? `https://${TEXTURE_HOST}/texture/${match[1]}` : null;
  } catch {
    return null;
  }
}

async function readJsonResponse<T>(
  response: Response,
  notFoundCode = false,
): Promise<T> {
  if (response.status === 404 && notFoundCode) {
    throw new OfficialProfileError(
      "not_found",
      "The official Minecraft profile was not found.",
    );
  }
  if (!response.ok) {
    throw new OfficialProfileError(
      "unavailable",
      "The official Minecraft profile service is unavailable.",
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new OfficialProfileError(
      "invalid_profile",
      "The official Minecraft profile response is invalid.",
    );
  }
}

async function fetchWithTimeout(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch {
    throw new OfficialProfileError(
      "unavailable",
      "The official Minecraft profile service is unavailable.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function lookupOfficialProfile(
  username: string,
  fetcher: Fetcher = fetch,
): Promise<OfficialProfile> {
  const normalizedUsername = username.trim();
  if (!PROFILE_NAME_PATTERN.test(normalizedUsername)) {
    throw new OfficialProfileError(
      "invalid_username",
      "The Minecraft username is invalid.",
    );
  }

  const identity = await readJsonResponse<{ id?: unknown; name?: unknown }>(
    await fetchWithTimeout(fetcher, `${LOOKUP_URL}${encodeURIComponent(normalizedUsername)}`, {
      headers: { Accept: "application/json" },
    }),
    true,
  );
  if (
    typeof identity.id !== "string" ||
    !UUID_PATTERN.test(identity.id) ||
    typeof identity.name !== "string"
  ) {
    throw new OfficialProfileError(
      "invalid_profile",
      "The official Minecraft profile response is invalid.",
    );
  }

  const session = await readJsonResponse<{
    id?: unknown;
    name?: unknown;
    properties?: Array<{ name?: unknown; value?: unknown }>;
  }>(
    await fetchWithTimeout(fetcher, `${SESSION_PROFILE_URL}${identity.id}`, {
      headers: { Accept: "application/json" },
    }),
  );
  const textureProperty = session.properties?.find(
    (property) =>
      property.name === "textures" && typeof property.value === "string",
  );
  if (!textureProperty || typeof textureProperty.value !== "string") {
    throw new OfficialProfileError(
      "invalid_profile",
      "The official profile has no texture data.",
    );
  }

  const textureData = decodeBase64Json(textureProperty.value);
  const textures = textureData.textures as
    | {
        SKIN?: { url?: unknown; metadata?: { model?: unknown } };
        CAPE?: { url?: unknown };
      }
    | undefined;
  const skinUrl = officialTextureUrl(textures?.SKIN?.url);
  if (!skinUrl) {
    throw new OfficialProfileError(
      "invalid_profile",
      "The official profile has no valid skin texture.",
    );
  }
  const capeUrl = textures?.CAPE ? officialTextureUrl(textures.CAPE.url) : null;

  return {
    id: identity.id.toLowerCase(),
    name: identity.name,
    skinUrl,
    capeUrl,
    model: textures?.SKIN?.metadata?.model === "slim" ? "slim" : "classic",
  };
}

export async function fetchOfficialTexture(
  url: string,
  fetcher: Fetcher = fetch,
): Promise<ArrayBuffer> {
  const response = await fetchWithTimeout(fetcher, url, {
    headers: { Accept: "image/png" },
  });
  if (!response.ok) {
    throw new OfficialProfileError(
      "unavailable",
      "The official texture service is unavailable.",
    );
  }
  try {
    return await response.arrayBuffer();
  } catch {
    throw new OfficialProfileError(
      "invalid_profile",
      "The official texture response is invalid.",
    );
  }
}
