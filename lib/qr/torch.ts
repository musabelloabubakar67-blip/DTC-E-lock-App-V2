// §4 QR: torch feature-detect via getCapabilities().torch; toggle via applyConstraints. The
// torch button only ever renders when a track genuinely reports torch support (iOS Safari
// often doesn't) — never a button that silently does nothing.
export type TorchMediaTrackCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
};

export type TorchMediaTrackConstraintSet = MediaTrackConstraintSet & {
  torch?: boolean;
};

export function torchTrack(stream: MediaStream | null): MediaStreamTrack | null {
  if (!stream) return null;

  return (
    stream.getVideoTracks().find((track) => {
      const capabilities = track.getCapabilities?.() as TorchMediaTrackCapabilities | undefined;
      return Boolean(capabilities?.torch);
    }) ?? null
  );
}

export function streamHasTorch(stream: MediaStream | null): boolean {
  return Boolean(torchTrack(stream));
}

export async function setStreamTorch(stream: MediaStream | null, enabled: boolean): Promise<void> {
  const track = torchTrack(stream);
  if (!track) {
    throw new Error('TorchUnavailable');
  }

  await track.applyConstraints({
    advanced: [{ torch: enabled } as TorchMediaTrackConstraintSet],
  });
}
