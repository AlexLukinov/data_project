"""Aggregate shop orders revenue by day from MinIO (s3a) and write Parquet back to MinIO."""
from pyspark.sql import SparkSession
from pyspark.sql import functions as F


def main() -> None:
    """Read raw orders Parquet, aggregate daily revenue, write to s3a://spark/output/."""
    spark = SparkSession.builder.appName("shop-daily-revenue").getOrCreate()
    orders = spark.read.parquet("s3a://raw/shop/orders/")
    daily = (
        orders.withColumn("order_date", F.to_date("order_ts"))
        .groupBy("order_date")
        .agg(F.count(F.lit(1)).alias("orders"),
             F.round(F.sum("amount"), 2).alias("revenue"))
        .orderBy("order_date")
    )
    daily.show(5, truncate=False)
    daily.write.mode("overwrite").parquet("s3a://spark/output/daily_revenue/")
    spark.stop()


if __name__ == "__main__":
    main()
