import { App } from "aws-cdk-lib";
import { readStageConfig } from "../src/config.ts";
import { createInfrastructure } from "../src/stacks.ts";

const app = new App();
createInfrastructure(app, readStageConfig((key) => app.node.tryGetContext(key) ?? process.env[`CRM_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`]));
app.synth();
