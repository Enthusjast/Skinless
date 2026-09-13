import { describe, expect, it, vi } from "vitest";
import { lookupOfficialProfile } from "../src/utils/official-profile";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textureValue(): string {
  return btoa(
    JSON.stringify({
      textures: {
        SKIN: {
          url: "http://textures.minecraft.net/texture/" + "a".repeat(64),
          metadata: { model: "slim" },
        },
        CAPE: {
          url: "https://textures.minecraft.net/texture/" + "b".repeat(64),
        },
      },
    }),
  );
}

describe("official profile lookup", () => {
  it("resolves the official identity and safe texture URLs", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ id: "069a79f444e94726a5befca90e38aaf5", name: "Notch" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "069a79f444e94726a5befca90e38aaf5",
          name: "Notch",
          properties: [{ name: "textures", value: textureValue() }],
        }),
      );

    await expect(lookupOfficialProfile("Notch", fetcher)).resolves.toEqual({
      id: "069a79f444e94726a5befca90e38aaf5",
      name: "Notch",
      skinUrl: "https://textures.minecraft.net/texture/" + "a".repeat(64),
      capeUrl: "https://textures.minecraft.net/texture/" + "b".repeat(64),
      model: "slim",
    });
  });

  it("rejects invalid names, missing profiles, and untrusted texture hosts", async () => {
    await expect(
      lookupOfficialProfile("bad name", vi.fn()),
    ).rejects.toMatchObject({
      code: "invalid_username",
    });

    await expect(
      lookupOfficialProfile(
        "Notch",
        vi.fn().mockResolvedValueOnce(jsonResponse({}, 404)),
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    const unsafeValue = btoa(
      JSON.stringify({
        textures: {
          SKIN: { url: "https://attacker.example/texture/" + "a".repeat(64) },
        },
      }),
    );
    await expect(
      lookupOfficialProfile(
        "Notch",
        vi
          .fn()
          .mockResolvedValueOnce(
            jsonResponse({
              id: "069a79f444e94726a5befca90e38aaf5",
              name: "Notch",
            }),
          )
          .mockResolvedValueOnce(
            jsonResponse({
              properties: [{ name: "textures", value: unsafeValue }],
            }),
          ),
      ),
    ).rejects.toMatchObject({ code: "invalid_profile" });
  });
});
