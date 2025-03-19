import assert from "assert"
import { before, describe, test } from "node:test"
import { TestProcessorServer, firstCounterValue } from "@sentio/sdk/testing"
import {
    CONVEX_ADDRESS,
    CONVEX_PID,
    CURVE_GAUGE_ADDRESS,
    CURVE_POOL_ADDRESS,
    STAKEDAO_GAUGE_ADDRESS_PROXY,
    TEST,
    TEST_USER,
} from "./constants.js"
import { ConvexHolder, CurveHolder, Holder, StakeDaoHolder } from "./schema/store.js"
import { mockTransferLog } from "./types/eth/curvetwocryptooptimized.js"
import { mockDepositLog, mockWithdrawLog } from "./types/eth/liquiditygaugev4.js"
import { BigDecimal } from "@sentio/sdk"
import { mockDepositedLog, mockWithdrawnLog } from "./types/eth/booster.js"
import {
    mockDepositLog as mockDepositLogCurve,
    mockWithdrawLog as mockWithdrawLogCurve,
} from "./types/eth/liquiditygaugev6.js"
describe("Test Processor", () => {
    const service = new TestProcessorServer(() => import("./processor.js"))

    before(async () => {
        await service.start()
    })

    test("has valid config", async () => {
        const config = await service.getConfig({})
        assert(config.contractConfigs.length > 0)
    })
    // this mf
    // test("check curve lp transfer event handling", async () => {
    //     const resp = await service.eth.testLog(
    //         mockTransferLog(CURVE_POOL_ADDRESS, {
    //             sender: "0xf07f25d6d9AA46AD5ed7023786F1530F0647fA47",
    //             receiver: "0xb329e39ebefd16f40d38f07643652ce17ca5bac1",
    //             value: 10n ** 18n * 10n,
    //         })
    //     )

    //     const from = await service.store.list(Holder)
    //     // assert.equal(tokenCounter, 10n)
    //     assert(from.length == 2)
    // })

    test("check stakedao deposit", async () => {
        const resp = await service.eth.testLog(
            mockDepositLog(STAKEDAO_GAUGE_ADDRESS_PROXY, {
                provider: TEST_USER,
                value: 10n ** 18n * 10n,
            })
        )
        const expResult = BigDecimal(10)
        const fromStore = await service.store.list(StakeDaoHolder, [{ field: "id", op: "=", value: TEST_USER }])

        assert(fromStore[0].balance.comparedTo(expResult) == 0)
    })

    test("check stakedao withdrawal", async () => {
        const resp = await service.eth.testLog(
            mockWithdrawLog(STAKEDAO_GAUGE_ADDRESS_PROXY, {
                provider: TEST_USER,
                value: 10n ** 18n * 5n,
            })
        )

        const expResult = BigDecimal(5)
        const fromStore = await service.store.list(StakeDaoHolder, [{ field: "id", op: "=", value: TEST_USER }])

        assert(fromStore[0].balance.comparedTo(expResult) == 0)
    })

    test("check convex deposit", async () => {
        const resp = await service.eth.testLog(
            mockDepositedLog(CONVEX_ADDRESS, {
                user: TEST_USER,
                poolid: BigInt(CONVEX_PID),
                amount: 10n ** 18n * 10n,
            })
        )
        const expResult = BigDecimal(10)
        const fromStore = await service.store.list(ConvexHolder, [{ field: "id", op: "=", value: TEST_USER }])

        assert(fromStore[0].balance.comparedTo(expResult) == 0)
    })

    test("check convex withdrawal", async () => {
        const resp = await service.eth.testLog(
            mockWithdrawnLog(CONVEX_ADDRESS, {
                user: TEST_USER,
                poolid: BigInt(CONVEX_PID),
                amount: 10n ** 18n * 5n,
            })
        )

        const expResult = BigDecimal(5)
        const fromStore = await service.store.list(ConvexHolder, [{ field: "id", op: "=", value: TEST_USER }])

        assert(fromStore[0].balance.comparedTo(expResult) == 0)
    })

    test("check curve gauge deposit", async () => {
        const resp = await service.eth.testLog(
            mockDepositLogCurve(CURVE_GAUGE_ADDRESS, {
                provider: TEST_USER,
                value: 10n ** 18n * 10n,
            })
        )
        const expResult = BigDecimal(10)
        const fromStore = await service.store.list(CurveHolder, [{ field: "id", op: "=", value: TEST_USER }])

        assert(fromStore[0].balance.comparedTo(expResult) == 0)
    })

    test("check curve gauge withdrawal", async () => {
        const resp = await service.eth.testLog(
            mockWithdrawLogCurve(CURVE_GAUGE_ADDRESS, {
                provider: TEST_USER,
                value: 10n ** 18n * 5n,
            })
        )

        const expResult = BigDecimal(5)
        const fromStore = await service.store.list(ConvexHolder, [{ field: "id", op: "=", value: TEST_USER }])

        assert(fromStore[0].balance.comparedTo(expResult) == 0)
    })
})
