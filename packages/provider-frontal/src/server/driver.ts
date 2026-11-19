import { TextGenerationError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import { makeManualOnlyProviderMaintenanceCapabilities } from "@t3tools/provider-core/server/maintenanceResolver";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@t3tools/provider-core/server/snapshotSettings";
import type { ProviderAdapterDriver } from "@t3tools/provider-core/server/adapterDriver";
import { FrontalSettings } from "../settings.ts";
import {
  FrontalAdapterV2Driver,
  FRONTAL_PROVIDER,
  type FrontalAdapterV2DriverEnv,
} from "./adapter.ts";
import { buildInitialFrontalProviderSnapshot, checkFrontalProviderStatus } from "./status.ts";

const decodeSettings = Schema.decodeSync(FrontalSettings);

const unsupportedTextGeneration = {
  generateCommitMessage: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateCommitMessage",
        detail: "Frontal Code does not provide T3 text generation.",
      }),
    ),
  generatePrContent: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generatePrContent",
        detail: "Frontal Code does not provide T3 text generation.",
      }),
    ),
  generateBranchName: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateBranchName",
        detail: "Frontal Code does not provide T3 text generation.",
      }),
    ),
  generateThreadTitle: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateThreadTitle",
        detail: "Frontal Code does not provide T3 text generation.",
      }),
    ),
  generateReviewGuide: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateReviewGuide",
        detail: "Frontal Code does not provide T3 text generation.",
      }),
    ),
  generateTranscriptionPostProcessing: () =>
    Effect.fail(
      new TextGenerationError({
        operation: "generateTranscriptionPostProcessing",
        detail: "Frontal Code does not provide T3 text generation.",
      }),
    ),
};

export type FrontalDriverEnv =
  | FrontalAdapterV2DriverEnv
  | ProviderHost.ProviderHost
  | ChildProcessSpawner.ChildProcessSpawner;

export const FrontalDriver: ProviderDriver<FrontalSettings, FrontalDriverEnv> = {
  driverKind: FRONTAL_PROVIDER,
  metadata: { displayName: "Frontal Code", supportsMultipleInstances: true },
  configSchema: FrontalSettings,
  defaultConfig: () => decodeSettings({}),
  create: Effect.fn("FrontalDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const hostEnvironment = yield* HostProcess.Environment;
    const homeDirectory = yield* HostProcess.HomeDirectory;
    const processEnvironment = yield* mergeProviderInstanceEnvironment(
      environment,
      hostEnvironment,
    );
    const effectiveConfig = {
      ...config,
      enabled,
      binaryPath: expandHomePath(config.binaryPath, homeDirectory),
      homePath: expandHomePath(config.homePath, homeDirectory),
      configPath: expandHomePath(config.configPath, homeDirectory),
    } satisfies FrontalSettings;
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: FRONTAL_PROVIDER,
      instanceId,
    });
    const stampIdentity = withInstanceIdentity({
      instanceId,
      driverKind: FRONTAL_PROVIDER,
      displayName,
      accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });
    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<FrontalSettings>>({
      resolveMaintenance: () =>
        Effect.succeed(
          makeManualOnlyProviderMaintenanceCapabilities({
            provider: FRONTAL_PROVIDER,
            packageName: null,
          }),
        ),
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      initialSnapshot: (settings) =>
        buildInitialFrontalProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
      checkProvider: checkFrontalProviderStatus(effectiveConfig, processEnvironment).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.map(stampIdentity),
      ),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: FRONTAL_PROVIDER,
            instanceId,
            detail: "Failed to build Frontal Code provider snapshot.",
            cause,
          }),
      ),
    );
    const orchestrationAdapter = yield* (
      FrontalAdapterV2Driver as ProviderAdapterDriver<FrontalSettings, FrontalAdapterV2DriverEnv>
    )
      .create({
        instanceId,
        displayName,
        accentColor,
        environment,
        enabled,
        config: effectiveConfig,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: FRONTAL_PROVIDER,
              instanceId,
              detail: "Failed to build Frontal Code orchestration adapter.",
              cause,
            }),
        ),
      );
    return {
      instanceId,
      driverKind: FRONTAL_PROVIDER,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      snapshot,
      orchestrationAdapter,
      textGeneration: unsupportedTextGeneration,
    } satisfies ProviderInstance;
  }),
};
