/* eslint-disable @typescript-eslint/no-unused-vars */
import * as fs from 'fs'
import * as core from '@actions/core'
import { RunScriptStepArgs } from 'hooklib'
import {
  execCalculateOutputHash,
  execCp,
  execPodStep,
  localCalculateOutputHash
} from '../k8s'
import { writeEntryPointScript, sleep, listDirAllCommand } from '../k8s/utils'
import { JOB_CONTAINER_NAME } from './constants'

export async function runScriptStep(
  args: RunScriptStepArgs,
  state,
  responseFile
): Promise<void> {
  // Write the entrypoint first. This will be later coppied to the workflow pod
  const { entryPoint, entryPointArgs, environmentVariables } = args
  const { containerPath, runnerPath } = writeEntryPointScript(
    args.workingDirectory,
    entryPoint,
    entryPointArgs,
    args.prependPath,
    environmentVariables
  )

  await execCp(state.jobPod)

  const want = await localCalculateOutputHash([
    'sh',
    '-c',
    listDirAllCommand('/home/runner/_work')
  ])

  let attempts = 10
  const delay = 1000
  for (let i = 0; i < attempts; i++) {
    try {
      const got = await execCalculateOutputHash(
        state.jobPod,
        JOB_CONTAINER_NAME,
        ['sh', '-c', listDirAllCommand('/__w')]
      )

      if (got !== want) {
        core.debug(
          `The hash of the directory does not match the expected value; want='${want}' got='${got}'`
        )
        await sleep(delay)
        continue
      }

      break
    } catch (error) {
      core.debug(`Attempt ${i + 1} failed: ${error}`)
      await sleep(delay)
    }
  }

  // Execute the entrypoint script
  args.entryPoint = 'sh'
  args.entryPointArgs = ['-e', containerPath]
  try {
    await execPodStep(
      [args.entryPoint, ...args.entryPointArgs],
      state.jobPod,
      JOB_CONTAINER_NAME
    )
  } catch (err) {
    core.debug(`execPodStep failed: ${JSON.stringify(err)}`)
    const message = (err as any)?.response?.body?.message || err
    throw new Error(`failed to run script step: ${message}`)
  } finally {
    // console.log('Sleeping 30s')
    // await sleep(30000)

    fs.rmSync(runnerPath)
  }
}
