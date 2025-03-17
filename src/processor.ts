import { BigDecimal, Counter, Gauge, scaleDown, TokenAmount } from "@sentio/sdk"
import { ERC20Processor } from "@sentio/sdk/eth/builtin"
import {
    BoosterProcessor,
    curvetwocryptooptimized,
    CurveTwocryptoOptimizedProcessor,
    liquiditygaugev4,
    LiquidityGaugeV4Processor,
    LiquidityGaugeV6Processor,
} from "./types/eth/index.js"
import {
    CONVEX_ADDRESS,
    CONVEX_PID,
    CPOOL_DECIMALS,
    CURVE_GAUGE_ADDRESS,
    CURVE_POOL_ADDRESS,
    STAKEDAO_GAUGE_ADDRESS_PROXY,
    STAKEDAO_VAULT,
    START_BLOCK,
} from "./constants.js"
import {
    CurveTwocryptoOptimized,
    CurveTwocryptoOptimizedContext,
    TransferEvent,
} from "./types/eth/curvetwocryptooptimized.js"
import { ConvexHolder, CurveHolder, Holder, StakeDaoHolder } from "./schema/store.js"
import { DepositEvent as StakedaoDepositEvent, LiquidityGaugeV4Context } from "./types/eth/liquiditygaugev4.js"
import { token } from "@sentio/sdk/utils"
import { BoosterContext, DepositedEvent as ConvexDepositEvent, WithdrawnEvent } from "./types/eth/booster.js"
import {
    DepositEvent as CurveDepositEvent,
    LiquidityGaugeV6Context,
    WithdrawEvent as CurveWithdrawEvent,
} from "./types/eth/liquiditygaugev6.js"

const TransferEventHandler = async function (event: TransferEvent, ctx: CurveTwocryptoOptimizedContext) {
    const senderBalance = await ctx.contract.balanceOf(event.args.sender)
    const receiverBalance = await ctx.contract.balanceOf(event.args.receiver)
    let from = new Holder({
        id: event.args.sender,
        balance: scaleDown(senderBalance, CPOOL_DECIMALS),
    })
    const to = new Holder({
        id: event.args.receiver,
        balance: scaleDown(receiverBalance, CPOOL_DECIMALS),
    })

    await ctx.store.upsert(from)
    await ctx.store.upsert(to)
}
const deposit = Gauge.register("Deposit")
const deposit_acc = Counter.register("Deposit_acc")

CurveTwocryptoOptimizedProcessor.bind({ address: CURVE_POOL_ADDRESS, startBlock: START_BLOCK }).onEventTransfer(
    TransferEventHandler
)

const CallDepositHandler = async function (event: StakedaoDepositEvent, ctx: LiquidityGaugeV4Context) {
    const tokenInfo = await token.getERC20TokenInfo(ctx, ctx.contract.address)
    const stdHolder = new StakeDaoHolder({
        id: event.args.toObject.name,
        balance: scaleDown(event.args.value, CPOOL_DECIMALS),
    })
    deposit.record(ctx, event.args.value, { token: tokenInfo.symbol })
    deposit_acc.add(ctx, event.args.value, { token: tokenInfo.symbol })
    await ctx.store.upsert(stdHolder)
}

LiquidityGaugeV4Processor.bind({ address: STAKEDAO_GAUGE_ADDRESS_PROXY, startBlock: START_BLOCK }).onEventDeposit(
    CallDepositHandler
)

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
    const amount = scaleDown(event.args.amount, CPOOL_DECIMALS)
    const newBalance = userStore ? Number(userStore!.balance) - Number(amount) : amount

    const updatedHolder = new ConvexHolder({
        id: event.args.user,
        balance: BigDecimal(newBalance),
    })
    await ctx.store.upsert(updatedHolder)
}

BoosterProcessor.bind({ address: CONVEX_ADDRESS, startBlock: START_BLOCK })
    .onEventDeposited(ConvexDepositEventHandler)
    .onEventWithdrawn(ConvexWithdrawEventHandler)

const CurveGaugeDepositHandler = async function (event: CurveDepositEvent, ctx: LiquidityGaugeV6Context) {
    const oldBalance = await ctx.store.get(CurveHolder, event.args.provider)
    console.log("Curve deposit " + event.args.provider + " value " + event.args.value)
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
    const amount = scaleDown(event.args.value, CPOOL_DECIMALS)
    const newBalance = userStore ? Number(userStore.balance) - Number(amount) : amount
    console.log(
        "Curve withdraw " +
            event.args.provider +
            " value " +
            event.args.value +
            " New balance " +
            newBalance +
            " userstore " +
            userStore
    )

    const updatedHolder = new ConvexHolder({
        id: event.args.provider,
        balance: BigDecimal(newBalance),
    })
    await ctx.store.upsert(updatedHolder)
}

LiquidityGaugeV6Processor.bind({ address: CURVE_GAUGE_ADDRESS, startBlock: START_BLOCK })
    .onEventDeposit(CurveGaugeDepositHandler)
    .onEventWithdraw(CurveGaugeWithdrawHandler)
