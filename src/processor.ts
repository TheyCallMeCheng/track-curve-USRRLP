import { BigDecimal, Counter, Gauge, scaleDown } from "@sentio/sdk"
import {
    BoosterProcessor,
    CurveTwocryptoOptimizedProcessor,
    LiquidityGaugeV4Processor,
    LiquidityGaugeV6Processor,
} from "./types/eth/index.js"
import {
    CONVEX_ADDRESS,
    CONVEX_PID,
    CPOOL_DECIMALS,
    CURVE_GAUGE_ADDRESS,
    CURVE_POOL_ADDRESS,
    RLP_ADDRESS,
    STAKEDAO_GAUGE_ADDRESS_PROXY,
    START_BLOCK,
    USR_ADDRESS,
} from "./constants.js"
import { CurveTwocryptoOptimizedContext, TransferEvent } from "./types/eth/curvetwocryptooptimized.js"
import { ConvexHolder, CurveHolder, Holder, StakeDaoHolder } from "./schema/store.js"
import {
    DepositEvent as StakedaoDepositEvent,
    LiquidityGaugeV4Context as StakedaoContext,
    WithdrawEvent as StakedaoWithdrawEvent,
} from "./types/eth/liquiditygaugev4.js"
import { BoosterContext, DepositedEvent as ConvexDepositEvent, WithdrawnEvent } from "./types/eth/booster.js"
import {
    DepositEvent as CurveDepositEvent,
    LiquidityGaugeV6Context,
    WithdrawEvent as CurveWithdrawEvent,
} from "./types/eth/liquiditygaugev6.js"
import { getPriceByType } from "@sentio/sdk/utils"
import { EthChainId } from "@sentio/sdk/eth"

// Curve pool holder tracker
const TransferEventHandler = async function (event: TransferEvent, ctx: CurveTwocryptoOptimizedContext) {
    const senderBalance = scaleDown(await ctx.contract.balanceOf(event.args.sender), CPOOL_DECIMALS)
    const receiverBalance = scaleDown(await ctx.contract.balanceOf(event.args.receiver), CPOOL_DECIMALS)

    const supply = scaleDown(await ctx.contract.totalSupply(), CPOOL_DECIMALS)
    const rlpContractBalance = scaleDown(await ctx.contract.balances(0), CPOOL_DECIMALS)
    const usrContractBalance = scaleDown(await ctx.contract.balances(1), CPOOL_DECIMALS)
    const usrPrice = (await getPriceByType(EthChainId.ETHEREUM, USR_ADDRESS, ctx.timestamp)) || 0
    const rlpPrice = (await getPriceByType(EthChainId.ETHEREUM, RLP_ADDRESS, ctx.timestamp)) || 0
    const ratioSender = senderBalance.dividedBy(supply)
    const ratioReceiver = receiverBalance.dividedBy(supply)

    const implicitUsrHoldingSender = ratioSender.multipliedBy(usrContractBalance)
    const implicitRlpHoldingSender = ratioSender.multipliedBy(rlpContractBalance)
    const usdValueSender = BigDecimal.sum(
        implicitUsrHoldingSender.multipliedBy(usrPrice),
        implicitRlpHoldingSender.multipliedBy(rlpPrice)
    )

    const implicitUsrHoldingReceiver = ratioReceiver.multipliedBy(usrContractBalance)
    const implicitRlpHoldingReceiver = ratioReceiver.multipliedBy(rlpContractBalance)
    const usdValueReceiver = BigDecimal.sum(
        implicitUsrHoldingReceiver.multipliedBy(usrPrice),
        implicitRlpHoldingReceiver.multipliedBy(rlpPrice)
    )
    console.log(
        "sender balance: " +
            senderBalance +
            "supply: " +
            supply +
            "usr price: " +
            usrPrice +
            "rlp price: " +
            rlpPrice +
            " ratio sender " +
            ratioSender +
            " implicit usr holdings " +
            implicitRlpHoldingSender +
            " usd value " +
            usdValueSender
    )
    const from = new Holder({
        id: event.args.sender,
        balance: senderBalance,
        usdValue: usdValueSender,
    })
    const to = new Holder({
        id: event.args.receiver,
        balance: receiverBalance,
        usdValue: usdValueReceiver,
    })

    await ctx.store.upsert(from)
    await ctx.store.upsert(to)
}
const deposit = Gauge.register("Deposit")
const deposit_acc = Counter.register("Deposit_acc")

CurveTwocryptoOptimizedProcessor.bind({ address: CURVE_POOL_ADDRESS, startBlock: START_BLOCK }).onEventTransfer(
    TransferEventHandler
)

// Stakedao Holders tracker
const StakedaoDepositEventHandler = async function (event: StakedaoDepositEvent, ctx: StakedaoContext) {
    const oldBalance = await ctx.store.get(StakeDaoHolder, event.args.provider)
    const stdHolder = new StakeDaoHolder({
        id: event.args.provider,
        balance: oldBalance
            ? BigDecimal.sum(scaleDown(event.args.value, CPOOL_DECIMALS), oldBalance.balance)
            : scaleDown(event.args.value, CPOOL_DECIMALS),
    })

    console.log("Stakedao deposit " + event.args.provider + " amount " + event.args.value)
    await ctx.store.upsert(stdHolder)
}
const StakedaoWithdrawEventHandler = async function (event: StakedaoWithdrawEvent, ctx: StakedaoContext) {
    const userStore = await ctx.store.get(StakeDaoHolder, event.args.provider)
    if (!userStore) {
        return
    }
    const amount = scaleDown(event.args.value, CPOOL_DECIMALS)
    const newBalance = Number(userStore.balance) - Number(amount)

    const updatedHolder = new StakeDaoHolder({
        id: event.args.provider,
        balance: BigDecimal(newBalance),
    })

    console.log(
        "Stakedao withdraw " + event.args.provider + " amount " + event.args.value + " hash " + ctx.transactionHash
    )

    await ctx.store.upsert(updatedHolder)
}

LiquidityGaugeV4Processor.bind({ address: STAKEDAO_GAUGE_ADDRESS_PROXY, startBlock: START_BLOCK })
    .onEventDeposit(StakedaoDepositEventHandler)
    .onEventWithdraw(StakedaoWithdrawEventHandler)

// Convex holders tracker
const ConvexDepositEventHandler = async function (event: ConvexDepositEvent, ctx: BoosterContext) {
    if (event.args.poolid != BigInt(CONVEX_PID)) {
        return
    }
    const oldBalance = await ctx.store.get(ConvexHolder, event.args.user)

    const CHolder = new ConvexHolder({
        id: event.args.user,
        balance: oldBalance
            ? BigDecimal.sum(scaleDown(event.args.amount, CPOOL_DECIMALS), oldBalance.balance)
            : scaleDown(event.args.amount, CPOOL_DECIMALS),
    })

    await ctx.store.upsert(CHolder)
}

const ConvexWithdrawEventHandler = async function (event: WithdrawnEvent, ctx: BoosterContext) {
    if (event.args.poolid != BigInt(CONVEX_PID)) {
        return
    }
    const userStore = await ctx.store.get(ConvexHolder, event.args.user)
    if (!userStore) {
        return
    }
    const amount = scaleDown(event.args.amount, CPOOL_DECIMALS)
    const newBalance = Number(userStore!.balance) - Number(amount)

    const updatedHolder = new ConvexHolder({
        id: event.args.user,
        balance: BigDecimal(newBalance),
    })
    await ctx.store.upsert(updatedHolder)
}

BoosterProcessor.bind({ address: CONVEX_ADDRESS, startBlock: START_BLOCK })
    .onEventDeposited(ConvexDepositEventHandler)
    .onEventWithdrawn(ConvexWithdrawEventHandler)

// Cruve gauge holders tracker
const CurveGaugeDepositHandler = async function (event: CurveDepositEvent, ctx: LiquidityGaugeV6Context) {
    const oldBalance = await ctx.store.get(CurveHolder, event.args.provider)
    // console.log("Curve deposit " + event.args.provider + " value " + event.args.value)
    const CurveGaugeHolder = new CurveHolder({
        id: event.args.provider,
        balance: oldBalance
            ? BigDecimal.sum(scaleDown(event.args.value, CPOOL_DECIMALS), oldBalance.balance)
            : scaleDown(event.args.value, CPOOL_DECIMALS),
    })

    await ctx.store.upsert(CurveGaugeHolder)
}

const CurveGaugeWithdrawHandler = async function (event: CurveWithdrawEvent, ctx: LiquidityGaugeV6Context) {
    const userStore = await ctx.store.get(CurveHolder, event.args.provider)
    if (!userStore) {
        return
    }

    const amount = scaleDown(event.args.value, CPOOL_DECIMALS)
    const newBalance = Number(userStore.balance) - Number(amount)

    const updatedHolder = new ConvexHolder({
        id: event.args.provider,
        balance: BigDecimal(newBalance),
    })
    await ctx.store.upsert(updatedHolder)
}

LiquidityGaugeV6Processor.bind({ address: CURVE_GAUGE_ADDRESS, startBlock: START_BLOCK })
    .onEventDeposit(CurveGaugeDepositHandler)
    .onEventWithdraw(CurveGaugeWithdrawHandler)
