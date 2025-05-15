// src/main.ts
import {
  wormhole,
  signSendWait, 
  toNative,
  encoding,
  // Types
  type Chain,
  type Network,
  type UniversalAddress, // Can be useful for VAA details
  type NativeAddress,    // Type of `toNative` result
  type WormholeMessageId,
  type UnsignedTransaction,
  type TransactionId,
  type Platform,         // Corrected type name
  type WormholeCore,     // Interface for the Core protocol client
  type Signer as WormholeSdkSigner, // Alias the SDK's Signer type
  type ChainContext,
} from '@wormhole-foundation/sdk';

// Platform-specific modules
import EvmPlatformLoader from '@wormhole-foundation/sdk/evm';
import { getEvmSigner } from '@wormhole-foundation/sdk-evm';
import { ethers, Wallet, JsonRpcProvider, Signer as EthersSigner } from 'ethers';
import { signEvmMessage } from './signMessage';

async function main() {
  // 1. Initialize Wormhole SDK
  const network = 'Testnet';
  const wh = await wormhole(network, [EvmPlatformLoader]);
  console.log('Wormhole SDK Initialized.');

  // 2. Get the EVM Signer (this is an ethers.js Signer)
  let ethersJsSigner: EthersSigner;
  let ethersJsProvider: JsonRpcProvider;

  try {
    // Modify signEvmMessage to also return the provider it created
    const signerResult = await signEvmMessage(); // Assume this now returns { signer, provider }
    ethersJsSigner = signerResult.signer;
    ethersJsProvider = signerResult.provider; // Get provider from signEvmMessage
    console.log(`Ethers.js Signer obtained for address: ${await ethersJsSigner.getAddress()}`);
  } catch (error) {
    console.error('Failed to get Ethers.js signer and provider:', error);
    process.exit(1);
  }

  // 3. Define the source chain context
  const sourceChainName: Chain = "Sepolia";
  const sourceChainContext = wh.getChain(sourceChainName) as ChainContext<"Testnet", "Sepolia", "Evm">;
  console.log(`Source chain context obtained for: ${sourceChainContext.chain}`);
  
  let sdkSigner: WormholeSdkSigner<Network, Chain>;
  try {
    // Call getEvmSigner, passing the ethers.Provider and the ethers.Signer
    // The `getEvmSigner` function will construct an EvmSigner instance.
    // Its first argument is an ethers Provider.
    // The second is the ethers Signer (or private key string).
    sdkSigner = await getEvmSigner(ethersJsProvider, ethersJsSigner);
    console.log(`Wormhole SDK Signer obtained for address: ${sdkSigner.address()}`);
  } catch (error) {
    console.error('Failed to get Wormhole SDK Signer:', error);
    process.exit(1);
  }
 
  // 5. Construct Your Message Payload
  const messageText = `HelloWormholeSDK-${Date.now()}`;
  const payload: Uint8Array = encoding.bytes.encode(messageText); // Use SDK's encoding util
  console.log(`Message to send: "${messageText}"`);

  // 6. Define Message Parameters
  const messageNonce = Math.floor(Math.random() * 1_000_000_000);
  const consistencyLevel = 1;
  console.log(`Using Nonce: ${messageNonce}, Consistency Level: ${consistencyLevel}`);

  try {
    // 7. Get the Core Protocol client
    const coreProtocolClient: WormholeCore<Network> = await sourceChainContext.getWormholeCore();

    // 8. Generate the Unsigned Transactions
    const whSignerAddress: NativeAddress<Chain> = toNative(sdkSigner.chain(), sdkSigner.address());
    console.log(`Preparing to publish message from ${whSignerAddress.toString()} on ${sourceChainContext.chain}...`);

    const unsignedTxs: AsyncGenerator<UnsignedTransaction<Network, Chain>> = coreProtocolClient.publishMessage(
      whSignerAddress, // Pass the NativeAddress
      payload,
      messageNonce,
      consistencyLevel
    );

    // 9. Sign and Send the Transactions 
    console.log("Signing and sending the message publication transaction(s)...");
    const txIds: TransactionId[] = await signSendWait(sourceChainContext, unsignedTxs, sdkSigner); // Use sdkSigner

    if (!txIds || txIds.length === 0) {
      throw new Error("No transaction IDs were returned from signSendWait.");
    }
    const primaryTxIdObject = txIds[txIds.length - 1];
    const primaryTxid = primaryTxIdObject.txid;

    console.log("Message publication transaction(s) sent!");
    console.log(`Primary Transaction ID for parsing: ${primaryTxid}`);
    console.log(`View on Sepolia Etherscan: https://sepolia.etherscan.io/tx/${primaryTxid}`);

    console.log("\nWaiting a few seconds for transaction to propagate before parsing...");
    await new Promise(resolve => setTimeout(resolve, 8000));

    // 10. Retrieve VAA Identifiers
    console.log(`Attempting to parse VAA identifiers from transaction: ${primaryTxid}...`);
    const messageIds: WormholeMessageId[] = await sourceChainContext.parseTransaction(primaryTxid);

    if (messageIds && messageIds.length > 0) {
      const wormholeMessageId = messageIds[0];
      console.log("--- VAA Identifiers (WormholeMessageId) ---");
      console.log("  Emitter Chain:", wormholeMessageId.chain);
      console.log("  Emitter Address:", wormholeMessageId.emitter.toString());
      console.log("  Sequence:", wormholeMessageId.sequence.toString());
      console.log("-----------------------------------------");
    } else {
      console.error(`Could not parse Wormhole Message IDs from transaction ${primaryTxid}.`);
    }

  } catch (error) {
    console.error("Error during message publishing or VAA identifier retrieval:", error);
    if (error instanceof Error && error.stack) {
        console.error("Stack Trace:", error.stack);
    }
  }
}

main().catch((e) => {
  console.error('Critical error in main function (outer catch):', e);
  if (e instanceof Error && e.stack) {
    console.error("Stack Trace:", e.stack);
  }
  process.exit(1);
});