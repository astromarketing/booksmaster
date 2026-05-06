import { Fyo, t } from 'fyo';
import { Action, ListViewSettings, ValidationMap } from 'fyo/model/types';
import { LedgerPosting } from 'models/Transactional/LedgerPosting';
import { ModelNameEnum } from 'models/types';
import {
  getAddedLPWithGrandTotal,
  getInvoiceActions,
  getReturnLoyaltyPoints,
  getTransactionStatusColumn,
} from '../../helpers';
import {
  Invoice,
  type InvoiceTaxItem,
  type TaxDetail,
} from '../Invoice/Invoice';
import { SalesInvoiceItem } from '../SalesInvoiceItem/SalesInvoiceItem';
import { LoyaltyProgram } from '../LoyaltyProgram/LoyaltyProgram';
import { DocValue } from 'fyo/core/types';
import { Party } from '../Party/Party';
import { ValidationError } from 'fyo/utils/errors';
import { Money } from 'pesa';
import { Doc } from 'fyo/model/doc';

export class SalesInvoice extends Invoice {
  items?: SalesInvoiceItem[];
  applyFreight?: boolean;
  freightAmount?: Money;

  getItemsNetTotal(): Money {
    const base = super.getItemsNetTotal();
    if (!this.applyFreight || !this.freightAmount || this.freightAmount.isZero()) {
      return base;
    }
    const f = this.freightAmount;
    if (this.isReturn) {
      return f.isPositive() ? base.add(f.neg()) : base.add(f);
    }
    return base.add(f);
  }

  override async getTaxItems(): Promise<InvoiceTaxItem[]> {
    const taxItems = await super.getTaxItems();
    if (
      !this.applyFreight ||
      !this.freightAmount ||
      this.freightAmount.isZero() ||
      this.discountAfterTax
    ) {
      return taxItems;
    }
    const ref = this.items?.find((i) => i.tax);
    if (!ref?.tax) {
      return taxItems;
    }
    const tax = await this.getTax(ref.tax);
    let freightAmt = this.freightAmount;
    if (this.isReturn && freightAmt.isPositive()) {
      freightAmt = freightAmt.neg();
    }
    for (const details of (tax.details ?? []) as TaxDetail[]) {
      taxItems.push({
        details,
        exchangeRate: this.exchangeRate ?? 1,
        fullAmount: freightAmt,
        taxAmount: freightAmt.mul(details.rate / 100),
      });
    }
    return taxItems;
  }

  async getPosting() {
    const exchangeRate = this.exchangeRate ?? 1;
    const posting: LedgerPosting = new LedgerPosting(this, this.fyo);
    if (this.isReturn) {
      await posting.credit(this.account!, this.baseGrandTotal!);
    } else {
      await posting.debit(this.account!, this.baseGrandTotal!);
    }

    for (const item of this.items!) {
      if (this.isReturn) {
        await posting.debit(item.account!, item.amount!.mul(exchangeRate));
        continue;
      }
      await posting.credit(item.account!, item.amount!.mul(exchangeRate));
    }

    if (
      this.applyFreight &&
      this.freightAmount &&
      !this.freightAmount.isZero() &&
      this.items?.[0]?.account
    ) {
      const acc = this.items[0].account as string;
      const amt = this.freightAmount.mul(exchangeRate).abs();
      if (this.isReturn) {
        await posting.debit(acc, amt);
      } else {
        await posting.credit(acc, amt);
      }
    }

    if (this.redeemLoyaltyPoints) {
      const loyaltyProgramDoc = (await this.fyo.doc.getDoc(
        ModelNameEnum.LoyaltyProgram,
        this.loyaltyProgram
      )) as LoyaltyProgram;

      let loyaltyAmount;

      if (this.isReturn) {
        loyaltyAmount = this.fyo.pesa(await getReturnLoyaltyPoints(this));
      } else {
        loyaltyAmount = await getAddedLPWithGrandTotal(
          this.fyo,
          this.loyaltyProgram as string,
          this.loyaltyPoints as number
        );
      }

      await posting.debit(
        loyaltyProgramDoc.expenseAccount as string,
        loyaltyAmount
      );
    }

    if (this.taxes) {
      for (const tax of this.taxes) {
        if (this.isReturn) {
          await posting.debit(tax.account!, tax.amount!.mul(exchangeRate));
          continue;
        }
        await posting.credit(tax.account!, tax.amount!.mul(exchangeRate));
      }
    }

    const discountAmount = this.getTotalDiscount();
    const discountAccount = this.fyo.singles.AccountingSettings
      ?.discountAccount as string | undefined;
    if (discountAccount && discountAmount.isPositive()) {
      if (this.isReturn) {
        await posting.credit(discountAccount, discountAmount.mul(exchangeRate));
      } else {
        await posting.debit(discountAccount, discountAmount.mul(exchangeRate));
      }
    }

    await posting.makeRoundOffEntry();
    return posting;
  }

  validations: ValidationMap = {
    loyaltyPoints: async (value: DocValue) => {
      if (!this.redeemLoyaltyPoints || this.isSubmitted || this.isReturn) {
        return;
      }

      const partyDoc = (await this.fyo.doc.getDoc(
        ModelNameEnum.Party,
        this.party
      )) as Party;

      if ((value as number) <= 0) {
        throw new ValidationError(t`Points must be greather than 0`);
      }

      if ((value as number) > (partyDoc?.loyaltyPoints || 0)) {
        throw new ValidationError(
          t`${this.party as string} only has ${
            partyDoc.loyaltyPoints as number
          } points`
        );
      }

      const loyaltyProgramDoc = (await this.fyo.doc.getDoc(
        ModelNameEnum.LoyaltyProgram,
        this.loyaltyProgram
      )) as LoyaltyProgram;
      const toDate = loyaltyProgramDoc?.toDate as Date;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (toDate && new Date(toDate).getTime() < today.getTime()) {
        return;
      }

      if (!this?.grandTotal) {
        return;
      }

      const loyaltyPoint =
        ((value as number) || 0) *
        ((loyaltyProgramDoc?.conversionFactor as number) || 0);

      if (!this.isReturn) {
        const totalDiscount = this.getTotalDiscount();
        let baseGrandTotal;

        if (!this.taxes!.length) {
          baseGrandTotal = (this.netTotal as Money).sub(totalDiscount);
        } else {
          baseGrandTotal = ((this.taxes ?? []) as Doc[])
            .map((doc) => doc.amount as Money)
            .reduce((a, b) => {
              if (this.isReturn) {
                return a.abs().add(b.abs()).neg();
              }
              return a.add(b.abs());
            }, (this.netTotal as Money).abs())
            .sub(totalDiscount);
        }

        if (baseGrandTotal?.lt(loyaltyPoint)) {
          throw new ValidationError(
            t`no need ${value as number} points to purchase this item`
          );
        }
      }
    },
  };

  static getListViewSettings(): ListViewSettings {
    return {
      columns: [
        'name',
        getTransactionStatusColumn(),
        'party',
        'date',
        'baseGrandTotal',
        'outstandingAmount',
      ],
    };
  }

  static getActions(fyo: Fyo): Action[] {
    return getInvoiceActions(fyo, ModelNameEnum.SalesInvoice);
  }
}
