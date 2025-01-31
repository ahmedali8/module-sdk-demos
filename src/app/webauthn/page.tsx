"use client";
import { Button } from "@/components/Button";
import { Connector } from "@/components/Connector";
import { getCount, getIncrementCalldata } from "@/components/Counter";
import Image from "next/image";
import { useCallback, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { Address, Hash } from "viem";
import {
  createWebAuthnCredential,
  P256Credential,
} from "viem/account-abstraction";
import { baseSepolia } from "viem/chains";
import { PublicKey } from "ox";
import { sign } from "ox/WebAuthnP256";
import { pimlicoBaseSepoliaUrl } from "@/utils/clients";
import { Footer } from "@/components/Footer";
import {
  createLazyAccount,
  getWebauthnValidatorMockSignature,
  getWebauthnValidatorSignature,
} from "lazyaccount";
import { GLOBAL_CONSTANTS } from "@rhinestone/module-sdk";
import { LazyAccountParams } from "lazyaccount/types";

const appId = "webauthn";

export default function Home() {
  const account = useAccount();
  const publicClient = usePublicClient();
  const walletClient = useWalletClient();

  const [lazyAccount, setLazyAccount] =
    useState<Awaited<ReturnType<typeof createLazyAccount>>>();
  const [smartAccountAddress, setSmartAccountAddress] = useState<Address>();
  const [credential, setCredential] = useState<P256Credential>(() =>
    JSON.parse(localStorage.getItem("credential") || "null")
  );
  const [validatorIsInstalled, setValidatorIsInstalled] = useState(false);

  const [validatorInstallationLoading, setValidatorInstallationLoading] =
    useState(false);
  const [userOpLoading, setUserOpLoading] = useState(false);
  const [count, setCount] = useState<number>(0);

  const createSafe = useCallback(async () => {
    const owner = account.address;
    const walletAccount = walletClient.data;

    if (!owner) {
      console.error("No owner");
      return;
    } else if (!walletAccount) {
      console.error("No wallet account");
      return;
    } else if (!publicClient) {
      console.error("No public client");
      return;
    }

    const params = {
      executionMode: "send",
      account: {
        type: "safe",
        address: owner,
        signer: walletAccount,
        validator: GLOBAL_CONSTANTS.WEBAUTHN_VALIDATOR_ADDRESS,
        deployedOnChains: [baseSepolia.id],
      },
      network: {
        ...baseSepolia,
        bundlerUrl: pimlicoBaseSepoliaUrl,
      },
    } as LazyAccountParams<"send">;

    const lazyAccount = await createLazyAccount(params);
    setLazyAccount(lazyAccount);

    const lazyAccountAddress = lazyAccount.address;
    setSmartAccountAddress(lazyAccountAddress);

    await lazyAccount.installOwnableValidator({
      owners: [owner],
      threshold: 1,
    });

    setCount(await getCount({ publicClient, account: lazyAccountAddress }));

    const isValidatorInstalled =
      await lazyAccount.isWebAuthnValidatorInstalled();

    if (isValidatorInstalled) {
      setValidatorIsInstalled(true);
    }
  }, [account, publicClient, walletClient]);

  const handleCreateCredential = useCallback(async () => {
    await createSafe();
    if (credential) return;
    const _credential = await createWebAuthnCredential({
      name: "Wallet Owner",
    });
    setCredential(_credential);
    localStorage.setItem(
      "credential",
      JSON.stringify({
        id: _credential.id,
        publicKey: _credential.publicKey,
      })
    );
  }, [createSafe, credential]);

  const handleInstallModule = useCallback(async () => {
    if (!credential) {
      console.error("No credential");
      return;
    } else if (!lazyAccount) {
      console.error("No lazy account");
      return;
    } else if (!smartAccountAddress) {
      console.error("No smart account address");
      return;
    }

    setValidatorInstallationLoading(true);

    const { x, y, prefix } = PublicKey.from(credential.publicKey);
    const installOp: Hash = (await lazyAccount.installWebAuthnValidator({
      pubKey: { x, y, prefix },
      authenticatorId: credential.id,
    })) as Hash;
    console.log("installOp: ", installOp);

    try {
      const receipt = await lazyAccount.waitForUserOpReceipt({
        hash: installOp,
      });
      console.log("receipt", receipt);
    } catch (error) {
      setValidatorInstallationLoading(false);

      console.log("error", error);
    }

    const isValidatorInstalled =
      await lazyAccount.isWebAuthnValidatorInstalled();

    if (isValidatorInstalled) {
      setValidatorIsInstalled(true);
    }

    setValidatorInstallationLoading(false);
  }, [credential, lazyAccount, smartAccountAddress]);

  const handleSendUserOp = useCallback(async () => {
    if (!credential) {
      console.error("No credential");
      return;
    } else if (!publicClient) {
      console.error("No public client");
      return;
    } else if (!lazyAccount) {
      console.error("No lazy account");
      return;
    } else if (!smartAccountAddress) {
      console.error("No smart account address");
      return;
    }

    setUserOpLoading(true);

    const userOperation = await lazyAccount.getUserOp({
      executions: [getIncrementCalldata()],
      signature: getWebauthnValidatorMockSignature(),
    });

    console.log("userOperation", userOperation);

    const userOpHashToSign = await lazyAccount.getUserOpHash({
      userOp: userOperation,
    });

    console.log("userOpHashToSign", userOpHashToSign);

    const { metadata: webauthn, signature } = await sign({
      credentialId: credential.id,
      challenge: userOpHashToSign,
    });

    const encodedSignature = getWebauthnValidatorSignature({
      webauthn,
      signature,
      usePrecompiled: false,
    });

    userOperation.signature = encodedSignature;

    const userOpHash = await lazyAccount.sendUserOp({ userOp: userOperation });

    const receipt = await lazyAccount.waitForUserOpReceipt({
      hash: userOpHash,
    });
    console.log("UserOp receipt: ", receipt);

    setCount(
      await getCount({
        publicClient,
        account: smartAccountAddress,
      })
    );
    setUserOpLoading(false);
  }, [credential, publicClient, lazyAccount, smartAccountAddress]);

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <Connector requiredChainId={baseSepolia.id} />
        <div className="flex flex-row items-center align-center">
          <Image
            className="dark:invert"
            src="/rhinestone.svg"
            alt="Rhinestone logo"
            width={180}
            height={38}
            priority
          />{" "}
          <span className="text-lg font-bold">x Webauthn</span>
        </div>
        <ol className="list-inside list-decimal text-sm text-center sm:text-left font-[family-name:var(--font-geist-mono)]">
          <li className="mb-2">Connect your EOA.</li>
          <li className="mb-2">Create a Webauthn credential.</li>
          <li className="mb-2">Install the webauthn module.</li>
          <li className="mb-2">
            Use the webauthn module to send a UserOperation.
          </li>
        </ol>
        <div className="font-[family-name:var(--font-geist-mono)] text-sm">
          <div>
            {smartAccountAddress && <>Smart account: {smartAccountAddress}</>}
          </div>
          <div>
            {smartAccountAddress && credential && (
              <>Webauthn credential: {credential.id}</>
            )}
          </div>
          <div>
            {smartAccountAddress && (
              <>Validator {!validatorIsInstalled && "not"} installed</>
            )}
          </div>
        </div>

        <div className="flex gap-4 items-center flex-col sm:flex-row">
          <Button
            buttonText="Create Credential"
            onClick={handleCreateCredential}
          />
          <Button
            buttonText="Install Webauthn Module"
            disabled={validatorIsInstalled}
            onClick={handleInstallModule}
            isLoading={validatorInstallationLoading}
          />
          <Button
            buttonText="Send UserOp"
            disabled={!validatorIsInstalled}
            onClick={handleSendUserOp}
            isLoading={userOpLoading}
          />
        </div>
      </main>
      <Footer count={count} appId={appId} />
    </div>
  );
}
