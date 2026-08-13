"""Read raw shop orders from MinIO (s3a parquet) and write a month-partitioned
Iceberg table to the Nessie REST catalog (lake.shop.daily_revenue), replacing the
old bare-Parquet output. Idempotent: createOrReplace rebuilds the table each run."""
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

SOURCE = "s3a://raw/shop/orders/"
TABLE = "lake.shop.daily_revenue"


def main() -> None:
    """Aggregate daily revenue and write it as a month-partitioned Iceberg table."""
    spark = SparkSession.builder.appName("shop-iceberg-daily-revenue").getOrCreate()

    orders = spark.read.parquet(SOURCE)
    daily = (
        orders.withColumn("order_date", F.to_date("order_ts"))
        .groupBy("order_date")
        .agg(
            F.count(F.lit(1)).alias("orders"),
            F.round(F.sum("amount"), 2).alias("revenue"),
        )
    )

    spark.sql("CREATE NAMESPACE IF NOT EXISTS lake.shop")
    (
        daily.writeTo(TABLE)
        .using("iceberg")
        .partitionedBy(F.months("order_date"))  # Iceberg hidden partitioning by month
        .createOrReplace()
    )

    spark.table(TABLE).orderBy("order_date").show(5, truncate=False)
    spark.stop()


if __name__ == "__main__":
    main()
