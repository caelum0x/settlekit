/**
 * Real `FxEscrow` ABI — captured from the VERIFIED on-chain contract on Arc
 * testnet (proxy 0x867650F5eAe8df91445971f14d89fd84F0C9a9f8, implementation
 * 0x721eAFa9C1e38DD7fFf81d30ea1a5500b37Cf658, "FxEscrow"). Not guessed: read via
 * the Arc Blockscout explorer API. Focused subset (the StableFX settlement
 * surface); the full 68-item ABI lives in the verified contract.
 */
export const FX_ESCROW_ABI = [
  {
    "inputs": [
      {
        "internalType": "uint256[]",
        "name": "ids",
        "type": "uint256[]"
      }
    ],
    "name": "batchBreach",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "breach",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "eip712Domain",
    "outputs": [
      {
        "internalType": "bytes1",
        "name": "fields",
        "type": "bytes1"
      },
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "version",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "chainId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "verifyingContract",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "uint256[]",
        "name": "extensions",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "getTradeDetails",
    "outputs": [
      {
        "components": [
          {
            "internalType": "contract ERC20",
            "name": "base",
            "type": "address"
          },
          {
            "internalType": "contract ERC20",
            "name": "quote",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "taker",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "maker",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "baseAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "quoteAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "takerFee",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "makerFee",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "takerRiskBuffer",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "makerRiskBuffer",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maturity",
            "type": "uint256"
          },
          {
            "internalType": "enum TradeStatus",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "enum FundingStatus",
            "name": "takerFundingStatus",
            "type": "uint8"
          },
          {
            "internalType": "enum FundingStatus",
            "name": "makerFundingStatus",
            "type": "uint8"
          }
        ],
        "internalType": "struct TradeDetails",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "lastTradeId",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "components": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "token",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
              }
            ],
            "internalType": "struct IPermit2.TokenPermissions",
            "name": "permitted",
            "type": "tuple"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "internalType": "struct IPermit2.PermitTransferFrom",
        "name": "permit",
        "type": "tuple"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "makerDeliver",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "permit2",
    "outputs": [
      {
        "internalType": "contract IPermit2",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "taker",
        "type": "address"
      },
      {
        "components": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "token",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
              }
            ],
            "internalType": "struct IPermit2.TokenPermissions",
            "name": "permitted",
            "type": "tuple"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "bytes32",
                    "name": "quoteId",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "address",
                    "name": "base",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "quote",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "baseAmount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "quoteAmount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "maturity",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct Consideration",
                "name": "consideration",
                "type": "tuple"
              },
              {
                "internalType": "address",
                "name": "recipient",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "fee",
                "type": "uint256"
              }
            ],
            "internalType": "struct TakerDetails",
            "name": "witness",
            "type": "tuple"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          }
        ],
        "internalType": "struct TakerPermitWitnessTransferFrom",
        "name": "takerPermit",
        "type": "tuple"
      },
      {
        "internalType": "address",
        "name": "maker",
        "type": "address"
      },
      {
        "components": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "token",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
              }
            ],
            "internalType": "struct IPermit2.TokenPermissions",
            "name": "permitted",
            "type": "tuple"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "fee",
                "type": "uint256"
              }
            ],
            "internalType": "struct MakerDetails",
            "name": "witness",
            "type": "tuple"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          }
        ],
        "internalType": "struct MakerPermitWitnessTransferFrom",
        "name": "makerPermit",
        "type": "tuple"
      }
    ],
    "name": "recordTrade",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "components": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "token",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
              }
            ],
            "internalType": "struct IPermit2.TokenPermissions",
            "name": "permitted",
            "type": "tuple"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "internalType": "struct IPermit2.PermitTransferFrom",
        "name": "permit",
        "type": "tuple"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "takerDeliver",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "trades",
    "outputs": [
      {
        "internalType": "contract ERC20",
        "name": "base",
        "type": "address"
      },
      {
        "internalType": "contract ERC20",
        "name": "quote",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "taker",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "maker",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "baseAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "quoteAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "takerFee",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "makerFee",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "takerRiskBuffer",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "makerRiskBuffer",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maturity",
        "type": "uint256"
      },
      {
        "internalType": "enum TradeStatus",
        "name": "status",
        "type": "uint8"
      },
      {
        "internalType": "enum FundingStatus",
        "name": "takerFundingStatus",
        "type": "uint8"
      },
      {
        "internalType": "enum FundingStatus",
        "name": "makerFundingStatus",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "quoteId",
        "type": "bytes32"
      }
    ],
    "name": "TradeRecorded",
    "type": "event"
  }
] as const;
